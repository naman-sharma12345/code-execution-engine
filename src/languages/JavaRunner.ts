/**
 * JavaRunner — compiles with `javac` and runs with `java`.
 *
 * Isolation tricks specific to Java:
 *   - `javac Main.java` produces `Main.class` in the work directory.
 *   - We run with `java -cp <workDir> Main`. Using `-cp` (not the default
 *     `.`) prevents the JVM from picking up stray `.class` files from CWD.
 *   - Memory limit is enforced via `-Xmx<MB>m` (max heap). The JVM's own
 *     metaspace/threads still grow outside the heap, so we add a 32MB headroom.
 *   - Class names are FIXED to `Main` to keep the runner simple. Users must
 *     declare `public class Main` — same convention as LeetCode/Codeforces.
 *
 * The Docker image (in production) would be `eclipse-temurin:21-jre-alpine`.
 */
import * as path from 'path'
import { LanguageRunner, type CompileResult, type RunCommand } from './LanguageRunner'
import type { Language } from '@/domain/enums'

export class JavaRunner extends LanguageRunner {
  readonly language: Language = 'java'
  readonly dockerImage = 'eclipse-temurin:21-jre-alpine'
  readonly fileExtension = 'java'
  readonly requiresCompile = true

  async compile(workDir: string, source: string): Promise<CompileResult> {
    const sourcePath = this.writeSource(workDir, source, 'Main.java')
    const result = await this.runCompile('javac', [sourcePath], workDir)
    return {
      ...result,
      artifactPath: result.success ? path.join(workDir, 'Main.class') : undefined,
    }
  }

  protected getRunCommand(workDir: string, _artifactPath?: string): RunCommand {
    return {
      executable: 'java',
      args: ['-cp', workDir, 'Main'],
    }
  }

  protected memoryLimitArgs(memoryLimitMb: number): string[] {
    // -Xmx is in MB. Reserve 32MB for JVM metaspace/thread stacks.
    return [`-Xmx${Math.max(64, memoryLimitMb - 32)}m`]
  }
}
