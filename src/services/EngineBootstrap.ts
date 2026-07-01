/**
 * Engine bootstrap — starts the worker pool + container pool on first import.
 *
 * Next.js dev server hot-reloads modules, which would normally cause us to
 * spawn a new worker pool on every code change. The `globalThis` guard
 * pattern ensures the pool is only created ONCE per process.
 *
 * Importing this module from any API route is enough to "wake up" the engine.
 */
import { startWorkerPool, getWorkers } from '@/workers/QueueWorker'
import { getContainerPool } from '@/services/ContainerPoolService'
import { getQueue } from '@/queue/SubmissionQueue'

declare global {
   
  var __aetherEngineStarted: boolean | undefined
}

export function ensureEngineStarted() {
  if (globalThis.__aetherEngineStarted) {
    return {
      queue: getQueue(),
      workers: getWorkers(),
      pool: getContainerPool(),
    }
  }
  globalThis.__aetherEngineStarted = true

  // Touch the queue singleton first so its event listeners are wired up.
  getQueue()
  // Pre-warm the container pool (no-op CPU-wise — just bookkeeping).
  getContainerPool()
  // Start the worker pool.
  const workers = startWorkerPool()

  console.log('[engine] AetherRun engine started:', {
    workers: workers.length,
    pool: getContainerPool().stats(),
  })

  return {
    queue: getQueue(),
    workers,
    pool: getContainerPool(),
  }
}
