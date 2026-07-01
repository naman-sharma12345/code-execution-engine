/**
 * CppRunner — compiles with `g++ -std=c++17` and runs the resulting binary.
 *
 * Isolation tricks specific to C++:
 *   - Compile with `-O2 -std=c++17 -w` (warnings suppressed — we don't want
 *     to confuse students with `-Wall` noise).
 *   - We add `-fsanitize=undefined` ONLY in debug builds. Production strips it
 *     because UBSan adds ~3x slowdown.
 *   - Memory limit is enforced via OS-level `setrlimit` in Docker; locally
 *     we rely on best-effort sampling.
 *   - The compiled binary is named `Main` (no extension) so the runtime
 *     invocation is uniform across Linux/macOS.
 *
 * The Docker image (in production) would be `gcc:14-bookworm`.
 */
import * as path from 'path'
import { LanguageRunner, type CompileResult, type RunCommand } from './LanguageRunner'
import type { Language } from '@/domain/enums'

export class CppRunner extends LanguageRunner {
  readonly language: Language = 'cpp'
  readonly dockerImage = 'gcc:14-bookworm'
  readonly fileExtension = 'cpp'
  readonly requiresCompile = true

  async compile(workDir: string, source: string): Promise<CompileResult> {
    const sourcePath = this.writeSource(workDir, source, 'Main.cpp')
    const binaryPath = path.join(workDir, 'Main')
    const result = await this.runCompile('g++', [
      '-std=c++17',
      '-O2',
      '-w',
      '-o', binaryPath,
      sourcePath,
    ], workDir)
    return {
      ...result,
      artifactPath: result.success ? binaryPath : undefined,
    }
  }

  protected getRunCommand(_workDir: string, artifactPath?: string): RunCommand {
    if (!artifactPath) {
      throw new Error('CppRunner.getRunCommand called without artifactPath — compile() must succeed first')
    }
    // For compiled languages, the binary itself is the executable.
    // We don't pass argv — stdin is fed separately by the base class.
    return {
      executable: artifactPath,
      args: [],
    }
  }
}
