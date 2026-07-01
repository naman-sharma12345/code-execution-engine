/**
 * Domain types — shared DTOs used by API, queue, worker, and services.
 * Persisted Prisma models live in `@prisma/client`; these are the
 * engine-specific shapes that flow between layers.
 */
import type {
  Language,
  SubmissionStatus,
  TestCaseStatus,
  SubscriptionTier,
} from './enums'

/** A test case in the shape the worker consumes it. */
export interface TestCaseData {
  id: string
  input: string
  expectedOutput: string
  isHidden: boolean
  order: number
}

/** A problem in the shape the worker consumes it. */
export interface ProblemData {
  id: string
  title: string
  description: string
  timeLimit: number      // ms, wall-clock
  cpuTimeLimit: number   // ms, CPU time
  memoryLimit: number    // MB
  testCases: TestCaseData[]
}

/** Payload used to enqueue a new submission job.
 *  This is what BullMQ would serialize into Redis. */
export interface SubmissionJobPayload {
  submissionId: string
  problemId: string
  userId: string
  language: Language
  code: string
  tier: SubscriptionTier
  enqueuedAt: number // epoch ms — used to compute queue wait time
}

/** Result of executing a single test case. */
export interface TestCaseResult {
  testCaseId: string
  status: TestCaseStatus
  stdout: string
  stderr: string
  exitCode: number
  executionTime: number // ms
  memoryUsed: number    // KB
}

/** Final result of processing a submission. Returned by the worker. */
export interface SubmissionResult {
  submissionId: string
  status: SubmissionStatus
  executionTime: number // ms, max across all test cases
  memoryUsed: number    // KB, max across all test cases
  testCasesPassed: number
  totalTestCases: number
  compileOutput?: string
  errorMessage?: string
  results: TestCaseResult[]
}

/** Heartbeat event the worker emits to the Socket.io bridge.
 *  The bridge then forwards it to the room `submission:<id>`. */
export interface SubmissionEvent {
  submissionId: string
  type:
    | 'status'         // status changed
    | 'compile'        // compile output (stdout/stderr) is available
    | 'testcase'       // a test case finished
    | 'log'            // generic log line (e.g., "spawning container…")
    | 'final'          // terminal result
  status?: SubmissionStatus
  message?: string
  testCase?: TestCaseResult
  compileOutput?: string
  result?: SubmissionResult
  timestamp: number
}

/** Shape of a job in the queue (combines payload + queue metadata). */
export interface QueuedJob {
  id: string
  payload: SubmissionJobPayload
  priority: number
  attempts: number
  maxAttempts: number
  enqueuedAt: number
  nextRetryAt?: number
}

/** Engine stats exposed via GET /api/stats. */
export interface EngineStats {
  queue: {
    waiting: number
    active: number
    delayed: number
    failed: number  // dead-letter count
    completed: number
  }
  workers: {
    count: number
    busy: number
    idle: number
  }
  containerPool: {
    total: number
    idle: number
    inUse: number
    warmsPerLanguage: Record<string, number>
  }
  throughput: {
    processed: number
    accepted: number
    rejected: number
    avgLatencyMs: number
  }
  uptimeMs: number
}
