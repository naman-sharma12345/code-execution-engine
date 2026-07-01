/**
 * RunnerFactory — the Abstract Factory entry point.
 *
 * Why a factory instead of a switch statement in the worker?
 *   - Open/Closed: adding a new language = adding a new class + one line in
 *     the registry. The worker never has to change.
 *   - The factory also serves as a singleton cache: we only need one instance
 *     of each runner (they're stateless after construction).
 *
 * The runner interface is uniform: `compile(workDir, source)` writes the
 * source file (and compiles if needed), then `run(opts, artifactPath)`
 * executes against a single stdin.
 */
import type { Language } from '@/domain/enums'
import { LanguageRunner, createWorkDir, cleanupWorkDir } from './LanguageRunner'
import { JavaScriptRunner } from './JavaScriptRunner'
import { PythonRunner } from './PythonRunner'
import { CppRunner } from './CppRunner'
import { JavaRunner } from './JavaRunner'

// Singleton registry — runners are stateless, one instance per process is fine.
const RUNNERS: Record<Language, LanguageRunner> = {
  javascript: new JavaScriptRunner(),
  python: new PythonRunner(),
  cpp: new CppRunner(),
  java: new JavaRunner(),
}

export function getRunner(language: Language): LanguageRunner {
  const runner = RUNNERS[language]
  if (!runner) {
    throw new Error(`No runner registered for language: ${language}`)
  }
  return runner
}

/**
 * Convenience: create a fresh work directory for a given language.
 * The worker uses this to keep tmp files isolated per-submission.
 */
export function createLanguageWorkDir(language: Language): string {
  return createWorkDir(`aether-${language}-`)
}

export { cleanupWorkDir, type LanguageRunner }
