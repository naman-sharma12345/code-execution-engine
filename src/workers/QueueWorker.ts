/**
 * QueueWorker — polls the SubmissionQueue and executes jobs.
 *
 * Lifecycle per job:
 *   1. Mark submission as COMPILING in the DB (so the UI shows progress).
 *   2. Fetch problem + test cases from DB.
 *   3. Compile user code (no-op for interpreted languages).
 *   4. Mark submission as RUNNING.
 *   5. For each test case:
 *        - Run program with stdin = test case input.
 *        - Capture stdout, stderr, exit code, time, peak RSS.
 *        - Classify the result (ACCEPTED / TLE / MLE / RTE / WRONG_ANSWER).
 *        - Stream the per-test-case event to Socket.io.
 *        - Stop early on the first hard failure (TLE/MLE/RTE) — this matches
 *          the Codeforces/LeetCode UX where users see the FIRST failure.
 *   6. Compute the submission-level status from the worst per-test-case status.
 *   7. Persist the final result + per-test-case ExecutionLog rows.
 *   8. Emit a 'final' Socket.io event so the UI can show the verdict.
 *   9. On infrastructure error (spawn failure, DB error): mark FAILED and
 *      let the queue retry with exponential backoff.
 *
 * Concurrency: each worker is one Node.js event-loop slot. We spawn N workers
 * in a Pool to get parallelism. CPU-bound work (g++/javac) is offloaded to
 * child processes so the event loop stays responsive.
 */
import { db } from '@/lib/db'
import { getQueue } from '@/queue/SubmissionQueue'
import { getRunner, createLanguageWorkDir, cleanupWorkDir } from '@/languages/RunnerFactory'
import { getChecker } from '@/domain/checker'
import type { SubmissionStatus, TestCaseStatus } from '@/domain/enums'
import type { TestCaseResult, SubmissionResult, SubmissionEvent } from '@/domain/types'
import { emitSubmissionEvent } from '@/services/EventBridge'
import * as os from 'os'

const POLL_INTERVAL_MS = 50 // tight loop — keeps latency low without burning CPU

/** Severity ranking — the worst status across test cases wins. */
const STATUS_SEVERITY: Record<TestCaseStatus, number> = {
  ACCEPTED: 0,
  SKIPPED: 1,
  WRONG_ANSWER: 2,
  RTE: 3,
  TLE: 4,
  MLE: 5,
}

export class QueueWorker {
  private running = false
  private busy = false
  private pollTimer: NodeJS.Timeout | null = null
  public readonly id: string

  constructor(id: string) {
    this.id = id
  }

  get isBusy() { return this.busy }

  async start() {
    if (this.running) return
    this.running = true
    console.log(`[worker:${this.id}] started`)
    this.schedulePoll()
  }

  async stop() {
    this.running = false
    if (this.pollTimer) clearTimeout(this.pollTimer)
    console.log(`[worker:${this.id}] stopped`)
  }

  private schedulePoll() {
    if (!this.running) return
    this.pollTimer = setTimeout(() => this.tick(), POLL_INTERVAL_MS)
  }

  private async tick() {
    if (!this.running) return

    // Don't grab a new job if we're still processing one. This makes each
    // worker strictly sequential — fine for a 4-CPU demo. For real
    // throughput we'd run multiple workers in a Pool (see WorkerPool.ts).
    if (this.busy) {
      this.schedulePoll()
      return
    }

    const queue = getQueue()
    const job = queue.poll()
    if (!job) {
      this.schedulePoll()
      return
    }

    this.busy = true
    try {
      await this.processJob(job.payload, job.id)
      queue.complete(job.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[worker:${this.id}] job ${job.id} crashed:`, msg)
      queue.fail(job.id, msg)
    } finally {
      this.busy = false
      this.schedulePoll()
    }
  }

  private async processJob(payload: SubmissionJobPayload, _jobId: string) {
    const { submissionId, problemId, language, code } = payload

    // 1. Fetch the submission, problem, and test cases in parallel.
    const submission = await db.submission.findUnique({
      where: { id: submissionId },
      include: { problem: { include: { testCases: { orderBy: { order: 'asc' } } } } },
    })

    if (!submission) {
      console.warn(`[worker] submission ${submissionId} not found — dropping job`)
      return
    }

    const problem = submission.problem
    const testCases = problem.testCases

    if (testCases.length === 0) {
      await this.finalize(submissionId, {
        submissionId,
        status: 'FAILED',
        executionTime: 0,
        memoryUsed: 0,
        testCasesPassed: 0,
        totalTestCases: 0,
        errorMessage: 'Problem has no test cases',
        results: [],
      })
      return
    }

    // 2. Update submission status to COMPILING and notify clients.
    await db.submission.update({
      where: { id: submissionId },
      data: { status: 'COMPILING', totalTestCases: testCases.length },
    })
    this.emit(submissionId, { type: 'status', status: 'COMPILING', message: `Compiling ${language}…`, timestamp: Date.now() })

    // 3. Compile the user's code in a fresh work directory.
    const runner = getRunner(language)
    const workDir = createLanguageWorkDir(language)

    let compileArtifact: string | undefined
    try {
      const compileResult = await runner.compile(workDir, code)
      if (!compileResult.success) {
        // Compile error — short-circuit to a FAILED verdict (no test cases run).
        await this.finalize(submissionId, {
          submissionId,
          status: 'FAILED',
          executionTime: 0,
          memoryUsed: 0,
          testCasesPassed: 0,
          totalTestCases: testCases.length,
          compileOutput: compileResult.stderr || compileResult.stdout,
          errorMessage: 'Compilation failed',
          results: testCases.map((tc) => ({
            testCaseId: tc.id,
            status: 'SKIPPED' as TestCaseStatus,
            stdout: '',
            stderr: '',
            exitCode: -1,
            executionTime: 0,
            memoryUsed: 0,
          })),
        })
        cleanupWorkDir(workDir)
        return
      }
      compileArtifact = compileResult.artifactPath

      if (compileResult.stdout || compileResult.stderr) {
        this.emit(submissionId, {
          type: 'compile',
          compileOutput: compileResult.stderr || compileResult.stdout,
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.finalize(submissionId, {
        submissionId,
        status: 'FAILED',
        executionTime: 0,
        memoryUsed: 0,
        testCasesPassed: 0,
        totalTestCases: testCases.length,
        errorMessage: `Compile error: ${msg}`,
        results: [],
      })
      cleanupWorkDir(workDir)
      return
    }

    // 4. Transition to RUNNING.
    await db.submission.update({
      where: { id: submissionId },
      data: { status: 'RUNNING' },
    })
    this.emit(submissionId, { type: 'status', status: 'RUNNING', message: 'Running test cases…', timestamp: Date.now() })

    // 5. Execute against each test case sequentially.
    const checker = getChecker('exact')
    const results: TestCaseResult[] = []
    let testCasesPassed = 0
    let maxTime = 0
    let maxMemory = 0
    let firstHardFailure: TestCaseStatus | null = null

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]

      // If we already hit a hard failure on a previous case, skip the rest.
      if (firstHardFailure) {
        results.push({
          testCaseId: tc.id,
          status: 'SKIPPED',
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 0,
          memoryUsed: 0,
        })
        this.emit(submissionId, {
          type: 'testcase',
          testCase: results[results.length - 1],
          timestamp: Date.now(),
        })
        continue
      }

      this.emit(submissionId, {
        type: 'log',
        message: `Test case ${i + 1}/${testCases.length} ${tc.isHidden ? '(hidden)' : ''}`,
        timestamp: Date.now(),
      })

      const runResult = await runner.run(
        {
          timeLimitMs: problem.timeLimit,
          memoryLimitMb: problem.memoryLimit,
          stdin: tc.input,
          workDir,
        },
        compileArtifact
      )

      let status: TestCaseStatus
      if (runResult.timedOut) {
        status = 'TLE'
      } else if (runResult.memoryUsedKb > problem.memoryLimit * 1024) {
        status = 'MLE'
      } else if (runResult.exitCode !== 0) {
        status = 'RTE'
      } else {
        const verdict = checker.check(
          { id: tc.id, input: tc.input, expectedOutput: tc.expectedOutput, isHidden: tc.isHidden, order: tc.order },
          runResult.stdout
        )
        status = verdict.accepted ? 'ACCEPTED' : 'WRONG_ANSWER'
      }

      const result: TestCaseResult = {
        testCaseId: tc.id,
        status,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: runResult.exitCode,
        executionTime: runResult.executionTimeMs,
        memoryUsed: runResult.memoryUsedKb,
      }
      results.push(result)
      if (status === 'ACCEPTED') testCasesPassed += 1
      if (runResult.executionTimeMs > maxTime) maxTime = runResult.executionTimeMs
      if (runResult.memoryUsedKb > maxMemory) maxMemory = runResult.memoryUsedKb

      // Stream the per-test-case result to the client in real-time.
      this.emit(submissionId, { type: 'testcase', testCase: result, timestamp: Date.now() })

      // Hard failures abort the loop — matches LeetCode/Codeforces UX.
      if (status === 'TLE' || status === 'MLE' || status === 'RTE') {
        firstHardFailure = status
      }
    }

    // 6. Compute submission-level verdict from the worst per-test-case status.
    let verdict: SubmissionStatus = 'ACCEPTED'
    if (firstHardFailure) {
      verdict = firstHardFailure as SubmissionStatus
    } else if (testCasesPassed < testCases.length) {
      verdict = 'WRONG_ANSWER'
    }

    // 7. Persist the final result.
    await this.finalize(submissionId, {
      submissionId,
      status: verdict,
      executionTime: maxTime,
      memoryUsed: maxMemory,
      testCasesPassed,
      totalTestCases: testCases.length,
      results,
    })

    // 8. Cleanup the work directory so /tmp doesn't fill up.
    cleanupWorkDir(workDir)
  }

  /** Persist the final result and emit a 'final' event to Socket.io. */
  private async finalize(submissionId: string, result: SubmissionResult) {
    await db.submission.update({
      where: { id: submissionId },
      data: {
        status: result.status,
        executionTime: result.executionTime,
        memoryUsed: result.memoryUsed,
        testCasesPassed: result.testCasesPassed,
        totalTestCases: result.totalTestCases,
        errorMessage: result.errorMessage,
        compileOutput: result.compileOutput,
        completedAt: new Date(),
      },
    })

    // Persist per-test-case logs (skipped if the array is empty).
    if (result.results.length > 0) {
      await db.executionLog.createMany({
        data: result.results.map((r) => ({
          submissionId,
          testCaseId: r.testCaseId,
          status: r.status,
          stdout: r.stdout.slice(0, 65000),  // SQLite TEXT cap safety
          stderr: r.stderr.slice(0, 65000),
          exitCode: r.exitCode,
          executionTime: r.executionTime,
          memoryUsed: r.memoryUsed,
        })),
      })
    }

    this.emit(submissionId, { type: 'final', result, timestamp: Date.now() })
  }

  private emit(submissionId: string, event: Omit<SubmissionEvent, 'submissionId'>) {
    emitSubmissionEvent({ ...event, submissionId })
  }
}

// ─── Worker Pool ──────────────────────────────────────────────────────
// We maintain a small pool of workers (default = number of CPUs, capped at 4)
// so that one slow job doesn't block the queue. Each worker polls the same
// queue — locking inside `poll()` prevents double-dispatch.

const NUM_WORKERS = Math.min(4, Math.max(1, os.cpus().length ?? 1))
const workers: QueueWorker[] = []

declare global {
   
  var __aetherWorkers: QueueWorker[] | undefined
}

export function startWorkerPool(): QueueWorker[] {
  if (globalThis.__aetherWorkers) return globalThis.__aetherWorkers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new QueueWorker(`worker-${i + 1}`)
    w.start()
    workers.push(w)
  }
  globalThis.__aetherWorkers = workers
  console.log(`[workers] pool started with ${NUM_WORKERS} workers`)
  return workers
}

export function getWorkers(): QueueWorker[] {
  return globalThis.__aetherWorkers ?? []
}

export function getWorkerStats() {
  const all = getWorkers()
  return {
    count: all.length,
    busy: all.filter((w) => w.isBusy).length,
    idle: all.filter((w) => !w.isBusy).length,
  }
}
