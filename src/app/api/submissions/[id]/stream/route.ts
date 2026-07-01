/**
 * GET /api/submissions/:id/stream — Server-Sent Events stream.
 *
 * Why SSE instead of Socket.io?
 *   - SSE runs natively inside Next.js API routes — no separate process,
 *     no port conflicts, no proxy configuration needed.
 *   - One-way server→client streaming is exactly what we need (the client
 *     doesn't need to send data back to the server mid-execution).
 *   - Auto-reconnects built into the browser's EventSource API.
 *   - Works through any HTTP proxy without special WebSocket upgrade handling.
 *
 * Flow:
 *   1. Client opens `new EventSource('/api/submissions/<id>/stream')`.
 *   2. This route subscribes to the in-memory AetherEventBus.
 *   3. Buffered events (from before the client connected) are flushed first.
 *   4. New events are streamed as SSE frames: `data: <JSON>\n\n`.
 *   5. On 'final' event, the route sends a final frame and closes.
 *   6. If the client disconnects, the subscription is cleaned up.
 */
import { NextRequest } from 'next/server'
import { getEventBus } from '@/services/EventBridge'
import { ensureEngineStarted } from '@/services/EngineBootstrap'

ensureEngineStarted()

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params
  const bus = getEventBus()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // 1. Flush any buffered events first (so late clients see full history).
      const buffered = bus.getBufferedEvents(submissionId)
      for (const ev of buffered) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }

      // 2. Check if we already have a 'final' event in the buffer — if so,
      //    close the stream immediately (the submission is done).
      const alreadyDone = buffered.some((e) => e.type === 'final')
      if (alreadyDone) {
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`))
        controller.close()
        return
      }

      // 3. Subscribe to live events for this submission.
      const unsubscribe = bus.subscribe(submissionId, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          // If this is the final event, close the stream.
          if (event.type === 'final') {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`))
            controller.close()
            unsubscribe()
          }
        } catch {
          // Client already disconnected — clean up.
          unsubscribe()
        }
      })

      // 4. Heartbeat every 15s to keep the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          clearInterval(heartbeat)
          unsubscribe()
        }
      }, 15_000)

      // 5. Clean up when the client disconnects.
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering (if behind nginx)
    },
  })
}
