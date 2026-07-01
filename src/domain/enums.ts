/**
 * Domain enums — single source of truth for the entire codebase.
 *
 * Why string-union types instead of TS `enum`?
 *   - String unions tree-shake better, don't emit extra JS, and serialize
 *     cleanly to JSON for API responses & DB persistence.
 *   - They are also fully compatible with Prisma's string columns.
 */

/** Supported execution languages. Add a new language by extending this union
 *  AND registering a runner in `languages/RunnerFactory.ts`. */
export type Language = 'javascript' | 'python' | 'cpp' | 'java'

/** Lifecycle of a submission. The worker drives these transitions:
 *  PENDING -> COMPILING -> RUNNING -> ACCEPTED | WRONG_ANSWER | TLE | MLE | RTE | FAILED
 *  (any failure during COMPILING/RUNNING skips to the matching terminal state)
 */
export type SubmissionStatus =
  | 'PENDING'      // queued, waiting for a worker
  | 'COMPILING'    // worker has picked it up and is compiling (if applicable)
  | 'RUNNING'      // binary/interpreter is executing against test cases
  | 'ACCEPTED'     // all test cases passed
  | 'WRONG_ANSWER' // at least one test case produced incorrect output
  | 'TLE'          // time limit exceeded on at least one test case
  | 'MLE'          // memory limit exceeded on at least one test case
  | 'RTE'          // runtime error (non-zero exit, segfault, etc.)
  | 'FAILED'       // infrastructure error (couldn't spawn container, etc.)

/** Per-test-case result status. EXECUTING is only used in-flight, never persisted. */
export type TestCaseStatus =
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'TLE'
  | 'MLE'
  | 'RTE'
  | 'SKIPPED'

/** Subscription tier — drives queue priority. PREMIUM = higher priority. */
export type SubscriptionTier = 'FREE' | 'PREMIUM'

export const ALL_LANGUAGES: Language[] = ['javascript', 'python', 'cpp', 'java']

export const LANGUAGE_LABELS: Record<Language, string> = {
  javascript: 'JavaScript (Node.js)',
  python: 'Python 3',
  cpp: 'C++ 17 (g++)',
  java: 'Java 21 (OpenJDK)',
}

export const LANGUAGE_FILE_EXTENSIONS: Record<Language, string> = {
  javascript: 'js',
  python: 'py',
  cpp: 'cpp',
  java: 'java',
}

/** Difficulty is metadata for the UI; not used by the engine. */
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'

/** Map a subscription tier to a BullMQ-style numeric priority. Higher = dequeued first. */
export const TIER_PRIORITY: Record<SubscriptionTier, number> = {
  PREMIUM: 10,
  FREE: 1,
}

/** Map a SubmissionStatus to a stable hex color for the frontend.
 *  Kept in the domain layer so both API and UI share one source of truth. */
export const STATUS_COLORS: Record<SubmissionStatus, string> = {
  PENDING: '#6b7280',       // gray-500
  COMPILING: '#f59e0b',     // amber-500
  RUNNING: '#3b82f6',       // blue-500
  ACCEPTED: '#10b981',      // emerald-500
  WRONG_ANSWER: '#ef4444',  // red-500
  TLE: '#f97316',           // orange-500
  MLE: '#a855f7',           // purple-500
  RTE: '#ec4899',           // pink-500
  FAILED: '#dc2626',        // red-600
}

/** True for terminal states (worker will not transition away from these). */
export const TERMINAL_STATUSES: SubmissionStatus[] = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'TLE',
  'MLE',
  'RTE',
  'FAILED',
]
