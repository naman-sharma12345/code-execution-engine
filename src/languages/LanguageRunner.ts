/**
 * Abstract LanguageRunner — the Abstract Factory product interface.
 *
 * In a Docker-based deployment, every method here would spawn a container,
 * mount the source as a read-only bind, and run inside it with cgroup limits.
 *
 * In this single-host demo we approximate isolation with:
 *   - `child_process.spawn` with a fresh process group (so we can kill the
 *     entire tree on timeout — prevents fork-bomb escapes).
 *   - `ulimit`-style flags via the language's own runtime where supported
 *     (e.g., Node's `--max-old-space-size`).
 *   - Stripped environment (`PATH` only) so user code can't exfiltrate
 *     secrets via env vars.
 *   - Strict wall-clock timeout via `setTimeout` + `process.kill(-pgid, SIGKILL)`.
 *
 * Subclasses MUST implement: `compile()`, `getRunCommand()`.
 */
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Language } from '@/domain/enums'

export interface CompileResult {
  success: boolean
  stdout: string
  stderr: string
  /** Path to the compiled artifact (binary / .class file). Empty if no compile step. */
  artifactPath?: string
}

export interface RunOptions {
  /** Wall-clock time limit in milliseconds. */
  timeLimitMs: number
  /** Memory limit in megabytes. */
  memoryLimitMb: number
  /** stdin to feed to the process. */
  stdin: string
  /** Working directory — pre-created, will be cleaned up by the caller. */
  workDir: string
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  executionTimeMs: number
  /** Best-effort peak RSS in KB. */
  memoryUsedKb: number
  timedOut: boolean
  signal?: string
}

/** Shape returned by `getRunCommand`: the executable + its argv. */
export interface RunCommand {
  /** argv[0] — the binary to spawn (e.g., `node`, `python3`, or the compiled binary path). */
  executable: string
  /** argv[1..] — flags + source path. */
  args: string[]
}

export abstract class LanguageRunner {
  abstract readonly language: Language
  /** Docker image name — used in container pooling / logs (not spawned locally). */
  abstract readonly dockerImage: string
  /** File extension without leading dot, e.g. `cpp`, `py`. */
  abstract readonly fileExtension: string
  /** True if the language requires a compile step (C++, Java). */
  abstract readonly requiresCompile: boolean

  /**
   * Compile the user's source code. Returns the artifact path on success.
   * Languages that don't need compilation (Python, JS) return immediately.
   */
  abstract compile(workDir: string, source: string): Promise<CompileResult>

  /**
   * Build the executable + argv used to spawn the runtime for a single test case.
   * For interpreted languages: returns the interpreter (e.g., `node`).
   * For compiled languages: returns the compiled binary path itself.
   */
  protected abstract getRunCommand(workDir: string, artifactPath?: string): RunCommand

  /** Optional memory-limit flag(s) injected into argv (e.g., Node's --max-old-space-size). */
  protected memoryLimitArgs(_memoryLimitMb: number): string[] {
    return []
  }

  /**
   * Run the program against a single stdin payload with strict limits.
   *
   * Why process groups (detached: true)?
   *   If a user program forks a child and we only `kill(child.pid)`, the
   *   grandchild survives and keeps consuming resources. Killing by negative
   *   PGID (`process.kill(-pgid)`) atomically kills the entire tree.
   */
  async run(opts: RunOptions, artifactPath?: string): Promise<RunResult> {
    const { executable, args } = this.getRunCommand(opts.workDir, artifactPath)
    const memArgs = this.memoryLimitArgs(opts.memoryLimitMb)
    const fullArgv = [...memArgs, ...args]

    const start = Date.now()
    let child: ChildProcess
    let peakMemoryKb = 0

    // Stripped env — prevents the user code from reading secrets / DB URLs.
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: opts.workDir,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    }

    if (executable === 'java') {
      // Java needs JAVA_HOME; harmless to add for other runtimes but kept here
      // to be explicit about why we allow it.
      safeEnv.JAVA_HOME = process.env.JAVA_HOME ?? '/usr/lib/jvm/default-java'
    }

    try {
      child = spawn(executable, fullArgv, {
        cwd: opts.workDir,
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // own process group so we can SIGKILL the whole tree
      })
    } catch (err) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: `Failed to spawn ${executable}: ${(err as Error).message}`,
        executionTimeMs: 0,
        memoryUsedKb: 0,
        timedOut: false,
      }
    }

    const pgid = child.pid ?? 0
    let stdoutBuf = ''
    let stderrBuf = ''
    let timedOut = false
    let memorySampler: NodeJS.Timeout | null = null
    let stdinError = false

    child.stdout?.on('data', (d) => {
      // Cap stdout at 1 MB to prevent OOM on infinite-output programs.
      if (stdoutBuf.length < 1024 * 1024) stdoutBuf += d.toString()
    })
    child.stderr?.on('data', (d) => {
      if (stderrBuf.length < 1024 * 1024) stderrBuf += d.toString()
    })

    // Feed stdin immediately (the child has its pipe open and is reading).
    try {
      child.stdin?.write(opts.stdin)
      child.stdin?.end()
    } catch {
      stdinError = true
    }

    // Best-effort peak RSS sampler.
    // We read /proc/<pid>/status directly — it's ~10x faster than spawning
    // `ps` and works even when the process is about to exit. The VmRSS line
    // is in KB. Returns 0 if the process is already gone (Linux-only; on
    // macOS this sampler silently no-ops and we rely on the OS to enforce MLE).
    const sampleMemory = () => {
      try {
        if (!child.pid) return
        const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8')
        const match = status.match(/VmRSS:\s*(\d+)\s*kB/)
        if (match) {
          const kb = parseInt(match[1], 10)
          if (!Number.isNaN(kb) && kb > peakMemoryKb) peakMemoryKb = kb
        }
      } catch {
        // Process exited or /proc not available — best-effort, ignore.
      }
    }
    memorySampler = setInterval(sampleMemory, 5)

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      try {
        // Kill the entire process group. SIGKILL because we're past the soft
        // limit and don't want to give the program a chance to clean up.
        if (pgid > 0) process.kill(-pgid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch { /* already dead */ }
      }
    }, opts.timeLimitMs)

    const exitInfo: { code: number | null; signal: string | null } = await new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }))
      child.on('error', () => resolve({ code: -1, signal: null }))
    })

    clearTimeout(timeoutHandle)
    if (memorySampler) clearInterval(memorySampler)

    const executionTimeMs = Date.now() - start

    if (stdinError && stderrBuf === '') {
      stderrBuf = 'Failed to write stdin to child process'
    }

    return {
      exitCode: exitInfo.code ?? -1,
      stdout: stdoutBuf,
      stderr: stderrBuf,
      executionTimeMs,
      memoryUsedKb: peakMemoryKb,
      timedOut,
      signal: exitInfo.signal ?? undefined,
    }
  }

  /** Helper: write source to a file in the work directory. */
  protected writeSource(workDir: string, source: string, filename: string): string {
    const fullPath = path.join(workDir, filename)
    fs.writeFileSync(fullPath, source, { mode: 0o644 })
    return fullPath
  }

  /** Helper: run a compile command (with a 10s cap). */
  protected async runCompile(
    executable: string,
    args: string[],
    workDir: string
  ): Promise<CompileResult> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        cwd: workDir,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: workDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (d) => (stdout += d.toString()))
      child.stderr?.on('data', (d) => (stderr += d.toString()))

      const timeout = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* dead */ }
      }, 10_000)

      child.on('exit', (code) => {
        clearTimeout(timeout)
        resolve({
          success: code === 0,
          stdout,
          stderr,
        })
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, stdout, stderr: err.message })
      })
    })
  }
}

/** Create a unique work directory under the OS temp dir. */
export function createWorkDir(prefix = 'aether-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

/** Recursively delete a work directory. Best-effort — never throws. */
export function cleanupWorkDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore — the OS will eventually clean /tmp
  }
}
