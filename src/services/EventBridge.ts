/**
 * EventBridge — in-process event bus for real-time submission events.
 *
 * Originally this bridged events from the worker to a separate Socket.io
 * mini-service via HTTP POST. We've since switched to Server-Sent Events
 * (SSE) which runs natively inside Next.js API routes — no separate process
 * to manage, no port conflicts, no proxy issues.
 *
 * The bridge is now a simple in-memory EventEmitter:
 *   - The worker calls `emitSubmissionEvent(event)` after each status change.
 *   - The SSE API route (`/api/submissions/[id]/stream`) subscribes to this
 *     emitter and forwards events to the client as SSE frames.
 *   - Events are also buffered per-submission for 60s so a client that
 *     connects slightly AFTER the worker starts (e.g., slow network) still
 *     sees the full event history.
 */
import { EventEmitter } from 'events'
import type { SubmissionEvent } from '@/domain/types'

const BUFFER_TTL_MS = 5 * 60 * 1000 // 5 minutes

class AetherEventBus extends EventEmitter {
  private buffers = new Map<string, SubmissionEvent[]>()
  private bufferTimers = new Map<string, NodeJS.Timeout>()

  /** Emit an event to all subscribers AND buffer it for late clients. */
  emitSubmissionEvent(event: SubmissionEvent) {
    // Buffer the event for late-arriving SSE clients.
    const buf = this.buffers.get(event.submissionId) ?? []
    buf.push(event)
    this.buffers.set(event.submissionId, buf)

    // Reset the buffer cleanup timer.
    const existingTimer = this.bufferTimers.get(event.submissionId)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      this.buffers.delete(event.submissionId)
      this.bufferTimers.delete(event.submissionId)
    }, BUFFER_TTL_MS)
    timer.unref?.()
    this.bufferTimers.set(event.submissionId, timer)

    // Notify live subscribers (the SSE route).
    this.emit(`event:${event.submissionId}`, event)
  }

  /** Get buffered events for a submission (for late-arriving clients). */
  getBufferedEvents(submissionId: string): SubmissionEvent[] {
    return [...(this.buffers.get(submissionId) ?? [])]
  }

  /** Subscribe to events for a specific submission. Returns an unsubscribe fn. */
  subscribe(submissionId: string, listener: (event: SubmissionEvent) => void): () => void {
    const channel = `event:${submissionId}`
    this.on(channel, listener)
    return () => this.off(channel, listener)
  }
}

declare global {
   
  var __aetherEventBus: AetherEventBus | undefined
}

export function getEventBus(): AetherEventBus {
  if (!globalThis.__aetherEventBus) {
    globalThis.__aetherEventBus = new AetherEventBus()
    // Increase the max listeners cap so many concurrent SSE clients don't
    // trigger Node's "possible memory leak" warning.
    globalThis.__aetherEventBus.setMaxListeners(100)
  }
  return globalThis.__aetherEventBus
}

/** Convenience: emit a submission event from anywhere in the worker. */
export function emitSubmissionEvent(event: SubmissionEvent): void {
  getEventBus().emitSubmissionEvent(event)
}
