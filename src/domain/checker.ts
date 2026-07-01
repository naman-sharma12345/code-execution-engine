/**
 * Checker interface — pluggable output comparison for non-exact-match problems.
 *
 * Why a separate interface?
 *   - Some problems allow multiple valid outputs (e.g., any valid topological
 *     ordering). Others need floating-point tolerance. A monolithic
 *     `expected === actual` check would force those problems to encode the
 *     tolerance inside the test-case data, leaking problem logic into data.
 *   - The Checker abstraction lets each problem declare its own comparator.
 *
 * Default implementation: `ExactChecker` (whitespace-trimmed line-by-line).
 */
import type { TestCaseData } from './types'

export interface Checker {
  /** Returns true if `actual` is accepted for the given test case. */
  check(testCase: TestCaseData, actual: string): { accepted: boolean; reason?: string }
}

/** Default checker — trims trailing whitespace per line, ignores trailing newline. */
export class ExactChecker implements Checker {
  check(testCase: TestCaseData, actual: string) {
    const normalize = (s: string) =>
      s
        .replace(/\r\n/g, '\n')        // normalize CRLF -> LF
        .split('\n')
        .map((l) => l.replace(/\s+$/g, '')) // trim trailing whitespace per line
        .join('\n')
        .replace(/\n+$/g, '\n')         // collapse trailing newlines to single \n
        .replace(/^\n+/, '')            // strip leading blank lines

    const expected = normalize(testCase.expectedOutput)
    const got = normalize(actual)
    const accepted = expected === got
    return {
      accepted,
      reason: accepted ? undefined : `Expected ${JSON.stringify(expected.slice(0, 80))}, got ${JSON.stringify(got.slice(0, 80))}`,
    }
  }
}

/** Floating-point tolerance checker. */
export class ToleranceChecker implements Checker {
  constructor(private readonly tolerance: number = 1e-6) {}

  check(testCase: TestCaseData, actual: string) {
    const expectedNums = testCase.expectedOutput
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
    const actualNums = actual
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)

    if (expectedNums.length !== actualNums.length) {
      return { accepted: false, reason: `Expected ${expectedNums.length} numbers, got ${actualNums.length}` }
    }
    for (let i = 0; i < expectedNums.length; i++) {
      if (Number.isNaN(actualNums[i])) {
        return { accepted: false, reason: `Output is not a number at position ${i}` }
      }
      if (Math.abs(expectedNums[i] - actualNums[i]) > this.tolerance) {
        return { accepted: false, reason: `Difference exceeds tolerance at position ${i}: |${expectedNums[i]} - ${actualNums[i]}| > ${this.tolerance}` }
      }
    }
    return { accepted: true }
  }
}

/** Checker registry — problems select a checker by name. */
const CHECKERS: Record<string, Checker> = {
  exact: new ExactChecker(),
  tolerance: new ToleranceChecker(1e-6),
}

export function getChecker(name: string = 'exact'): Checker {
  return CHECKERS[name] ?? CHECKERS.exact
}
