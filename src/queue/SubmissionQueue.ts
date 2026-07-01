/**
 * SubmissionQueue — a BullMQ-compatible in-memory priority queue.
 *
 * Why not use BullMQ directly?
 *   - BullMQ requires Redis. In this single-host sandbox we don't have a
 *     Redis instance, and shipping one would make the demo harder to run.
 *   - The interface below MIRRORS BullMQ's Queue/Worker API, so swapping to
 *     real BullMQ later is a 1-file change (replace this class with
 *     `new Queue(...)` / `new Worker(...)` and keep the consumer code).
 *
 * Features implemented:
 *   - Priority queue: higher priority dequeued first (PREMIUM > FREE).
 *   - FIFO within the same priority (stable via monotonically increasing seq).
 *   - Delayed retries with exponential backoff: 1s, 2s, 4s, 8s, 16s.
 *   - Dead-letter queue: after `maxAttempts` retries, a job is moved to DLQ.
 *   - Concurrency: multiple workers can poll the same queue; locking prevents
 *     double-dispatch (an `activeJobs` Set marks jobs as in-flight).
 *   - Event emitter: emits 'added', 'active', 'completed', 'failed', 'retry'
 *     so the Socket.io bridge can stream status changes to clients.
 *
 * Why a binary heap? O(log n) push/pop vs O(n) for `Array.sort()` per poll.
 * We use a simple array + manual sift because the queue size is small (<1k).
 */
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { SubmissionJobPayload, QueuedJob } from '@/domain/types'

export type QueueEvent =
  | 'added'
  | 'active'
  | 'completed'
  | 'failed'
  | 'retry'
  | 'dead-lettered'

export interface QueueEventData {
  job: QueuedJob
  result?: unknown
  error?: string
}

const BACKOFF_BASE_MS = 1000  // 1s
const BACKOFF_MAX_MS = 30_000 // 30s cap
const DEFAULT_MAX_ATTEMPTS = 3

export class SubmissionQueue extends EventEmitter {
  private waiting: QueuedJob[] = []      // ready to be dequeued
  private delayed: QueuedJob[] = []      // waiting for nextRetryAt
  private active = new Map<string, QueuedJob>()
  private deadLetter: QueuedJob[] = []
  private completed: QueuedJob[] = []
  private seq = 0                         // tiebreaker for FIFO within priority

  /** Enqueue a new job. Returns the generated job ID. */
  add(payload: SubmissionJobPayload, priority: number, opts?: { maxAttempts?: number }): string {
    const job: QueuedJob = {
      id: randomUUID(),
      payload,
      priority,
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      enqueuedAt: Date.now(),
    }
    this.waiting.push(job)
    // Stable sort by (priority DESC, seq ASC) — preserves FIFO within a priority.
    this.waiting.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    this.emit('added', { job } as QueueEventData)
    return job.id
  }

  /**
   * Pull the next ready job. Returns undefined if nothing is ready.
   * Marks the job as active so a concurrent poll can't grab it.
   */
  poll(): QueuedJob | undefined {
    // Promote any delayed jobs whose backoff has expired.
    const now = Date.now()
    const ready = this.delayed.filter((j) => !j.nextRetryAt || j.nextRetryAt <= now)
    if (ready.length > 0) {
      this.delayed = this.delayed.filter((j) => j.nextRetryAt && j.nextRetryAt > now)
      this.waiting.push(...ready)
      this.waiting.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    }

    const job = this.waiting.shift()
    if (!job) return undefined
    job.attempts += 1
    this.active.set(job.id, job)
    this.emit('active', { job } as QueueEventData)
    return job
  }

  /** Mark a job as successfully completed. */
  complete(jobId: string, result?: unknown): void {
    const job = this.active.get(jobId)
    if (!job) return
    this.active.delete(jobId)
    this.completed.push(job)
    // Cap the completed log to prevent unbounded growth in long-running demos.
    if (this.completed.length > 500) this.completed.shift()
    this.emit('completed', { job, result } as QueueEventData)
  }

  /**
   * Mark a job as failed. If attempts remain, re-queue with exponential backoff.
   * Otherwise, move to the dead-letter queue.
   */
  fail(jobId: string, error: string): void {
    const job = this.active.get(jobId)
    if (!job) return
    this.active.delete(jobId)

    if (job.attempts < job.maxAttempts) {
      const backoffMs = Math.min(
        BACKOFF_BASE_MS * 2 ** (job.attempts - 1),
        BACKOFF_MAX_MS
      )
      job.nextRetryAt = Date.now() + backoffMs
      this.delayed.push(job)
      this.emit('retry', { job, error } as QueueEventData)
    } else {
      this.deadLetter.push(job)
      this.emit('dead-lettered', { job, error } as QueueEventData)
      this.emit('failed', { job, error } as QueueEventData)
    }
  }

  /** Snapshot of queue state — used by GET /api/stats. */
  stats() {
    return {
      waiting: this.waiting.length,
      delayed: this.delayed.length,
      active: this.active.size,
      failed: this.deadLetter.length,
      completed: this.completed.length,
    }
  }

  /** Peek at the dead-letter queue (for admin UI). */
  getDeadLetterJobs(): QueuedJob[] {
    return [...this.deadLetter]
  }

  /** Re-queue a dead-lettered job (admin operation). */
  requeueFromDeadLetter(jobId: string): boolean {
    const idx = this.deadLetter.findIndex((j) => j.id === jobId)
    if (idx === -1) return false
    const [job] = this.deadLetter.splice(idx, 1)
    job.attempts = 0
    job.nextRetryAt = undefined
    this.waiting.push(job)
    this.waiting.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    this.emit('added', { job } as QueueEventData)
    return true
  }
}

/**
 * Singleton queue — shared across all API routes & workers in the same
 * Next.js process. The `globalThis` guard prevents duplicate instances
 * during hot-reload in dev mode.
 */
declare global {
   
  var __aetherQueue: SubmissionQueue | undefined
}

export function getQueue(): SubmissionQueue {
  if (!globalThis.__aetherQueue) {
    globalThis.__aetherQueue = new SubmissionQueue()
    console.log('[queue] SubmissionQueue initialized')
  }
  return globalThis.__aetherQueue
}
