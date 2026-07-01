/**
 * JavaScriptRunner — executes user code with `node`.
 *
 * Isolation tricks specific to Node:
 *   - `--max-old-space-size=<MB>` enforces a JS-heap cap. The process will
 *     throw a JS heap OOM and exit non-zero instead of growing unbounded.
 *   - `--no-warnings` keeps stderr clean (otherwise Node prints deprecation
 *     warnings to stderr, which we'd surface as RTE).
 *   - We do NOT use `vm` module here — `vm` is explicitly documented as
 *     NOT a security boundary. Process isolation is the right tool.
 *
 * The Docker image (in production) would be `node:22-alpine` running as
 * the non-root `node` user.
 */
import * as path from 'path'
import { LanguageRunner, type CompileResult, type RunCommand } from './LanguageRunner'
import type { Language } from '@/domain/enums'

export class JavaScriptRunner extends LanguageRunner {
  readonly language: Language = 'javascript'
  readonly dockerImage = 'node:22-alpine'
  readonly fileExtension = 'js'
  readonly requiresCompile = false

  async compile(workDir: string, source: string): Promise<CompileResult> {
    // Write the source file even though there's no compilation — the worker
    // calls compile() uniformly for all languages and then run().
    this.writeSource(workDir, source, 'Main.js')
    return { success: true, stdout: '', stderr: '' }
  }

  protected getRunCommand(workDir: string): RunCommand {
    return {
      executable: 'node',
      args: [path.join(workDir, 'Main.js')],
    }
  }

  protected memoryLimitArgs(memoryLimitMb: number): string[] {
    // --max-old-space-size is in MB. Reserve a small headroom so that
    // V8's own overhead doesn't trigger a false MLE on legit programs.
    return [`--max-old-space-size=${Math.max(64, memoryLimitMb - 16)}`, '--no-warnings']
  }
}
