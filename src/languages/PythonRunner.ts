/**
 * PythonRunner — executes user code with `python3`.
 *
 * Isolation tricks specific to Python:
 *   - `PYTHONUNBUFFERED=1` ensures stdout/stderr reach us in real-time
 *     (otherwise Socket.io streaming would batch them).
 *   - `python3 -u` also unbuffered — belt & suspenders.
 *   - Memory limit is enforced via OS-level cgroups in Docker; locally we
 *     rely on best-effort sampling and `setrlimit` via the runtime.
 *
 * The Docker image (in production) would be `python:3.12-slim`.
 */
import * as path from 'path'
import { LanguageRunner, type CompileResult, type RunCommand } from './LanguageRunner'
import type { Language } from '@/domain/enums'

export class PythonRunner extends LanguageRunner {
  readonly language: Language = 'python'
  readonly dockerImage = 'python:3.12-slim'
  readonly fileExtension = 'py'
  readonly requiresCompile = false

  async compile(workDir: string, source: string): Promise<CompileResult> {
    this.writeSource(workDir, source, 'Main.py')
    return { success: true, stdout: '', stderr: '' }
  }

  protected getRunCommand(workDir: string): RunCommand {
    return {
      executable: 'python3',
      // `-u` = unbuffered stdout/stderr (real-time streaming to Socket.io)
      args: ['-u', path.join(workDir, 'Main.py')],
    }
  }
}
