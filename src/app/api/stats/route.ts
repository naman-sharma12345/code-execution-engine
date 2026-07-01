/**
 * GET /api/stats — engine stats for the dashboard.
 *
 * Returns queue size, worker pool state, container pool state, throughput.
 */
import { NextResponse } from 'next/server'
import { ensureEngineStarted } from '@/services/EngineBootstrap'
import { getQueue } from '@/queue/SubmissionQueue'
import { getWorkerStats } from '@/workers/QueueWorker'
import { getContainerPool } from '@/services/ContainerPoolService'
import { db } from '@/lib/db'

// Track throughput since process start (best-effort).
declare global {
   
  var __aetherStats: {
    startedAt: number
    processed: number
    accepted: number
    rejected: number
    totalLatencyMs: number
    latencyCount: number
  } | undefined
}

function getStats() {
  if (!globalThis.__aetherStats) {
    globalThis.__aetherStats = {
      startedAt: Date.now(),
      processed: 0,
      accepted: 0,
      rejected: 0,
      totalLatencyMs: 0,
      latencyCount: 0,
    }
  }
  return globalThis.__aetherStats
}

// Wire up queue event listeners ONCE to track throughput.
ensureEngineStarted()
getQueue().on('completed', () => {
  const s = getStats()
  s.processed += 1
})
getQueue().on('dead-lettered', () => {
  const s = getStats()
  s.processed += 1
  s.rejected += 1
})

export async function GET() {
  try {
    const stats = getStats()
    const queue = getQueue()
    const workers = getWorkerStats()
    const pool = getContainerPool().stats()

    // Compute live throughput from DB (ground truth, not in-memory counters).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const [recentAccepted, recentFailed, totalSubmissions] = await Promise.all([
      db.submission.count({ where: { status: 'ACCEPTED', createdAt: { gte: oneHourAgo } } }),
      db.submission.count({
        where: {
          status: { in: ['WRONG_ANSWER', 'TLE', 'MLE', 'RTE', 'FAILED'] },
          createdAt: { gte: oneHourAgo },
        },
      }),
      db.submission.count(),
    ])

    return NextResponse.json({
      queue: queue.stats(),
      workers,
      containerPool: pool,
      throughput: {
        processed: stats.processed,
        accepted: recentAccepted,
        rejected: recentFailed,
        avgLatencyMs: stats.latencyCount > 0 ? Math.round(stats.totalLatencyMs / stats.latencyCount) : 0,
        totalSubmissions,
        lastHourAccepted: recentAccepted,
        lastHourRejected: recentFailed,
      },
      uptimeMs: Date.now() - stats.startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
