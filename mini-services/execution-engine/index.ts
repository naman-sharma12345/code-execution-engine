/**
 * AetherRun — Socket.io Mini-Service (real-time execution stream)
 * ----------------------------------------------------------------
 * Port: 3003 (must match the Caddyfile reverse-proxy rule).
 *
 * Architecture:
 *   - The Next.js worker (QueueWorker.ts) processes submissions and ships
 *     events to this service via HTTP POST /ingest.
 *   - This service fans out events to all Socket.io clients subscribed to
 *     the matching submission room (`submission:<id>`).
 *   - Clients connect from the browser via `io("/?XTransformPort=3003")`.
 *
 * Why a separate service?
 *   - Next.js dev server hot-reloads on every code change, which would drop
 *     every WebSocket connection. A dedicated service keeps connections
 *     stable across HMR.
 *   - The Socket.io service is stateless (it only routes events), so it can
 *     be horizontally scaled behind a sticky-session load balancer.
 *
 * IMPORTANT: We register the HTTP request handler BEFORE creating the
 * Socket.io server. Socket.io with `path: '/'` intercepts ALL HTTP requests
 * on its path, so we must get the first crack at /ingest and /health.
 */
import { createServer } from 'http'
import { Server } from 'socket.io'

// ─── HTTP request handler (registered BEFORE Socket.io) ──────────────
const httpServer = createServer((req, res) => {
  // POST /ingest — the worker ships events here.
  if (req.method === 'POST' && req.url === '/ingest') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const event = JSON.parse(body)
        const room = `submission:${event.submissionId}`
        // Fan out to all clients watching this submission.
        io.to(room).emit('submission:event', event)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON', detail: String(err) }))
      }
    })
    return
  }

  // GET /health — liveness probe.
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      connections: io.engine.clientsCount,
      uptime: process.uptime(),
    }))
    return
  }

  // For all other requests, return 404. Socket.io's own upgrade requests
  // (WebSocket handshake) bypass this handler entirely — they go through
  // the 'upgrade' event, not 'request'.
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

// ─── Socket.io server (created AFTER HTTP handlers) ──────────────────
// We use the DEFAULT path (`/socket.io/`) instead of `/`. This is critical:
//   - With `path: '/'`, Socket.io intercepts EVERY HTTP request on the server
//     (including our /ingest and /health endpoints), breaking them.
//   - With the default `/socket.io/`, Socket.io only handles requests to
//     `/socket.io/*`, leaving other paths free for our HTTP handlers.
//   - Caddy routes based on the XTransformPort QUERY PARAM, not the path, so
//     the frontend can still connect with `io("/?XTransformPort=3003")` and
//     socket.io-client will automatically append `/socket.io/` to the URL.
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

// ─── Socket.io connection handler ─────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket.io] client connected: ${socket.id}`)

  // Client subscribes to a specific submission's event stream.
  socket.on('subscribe', (submissionId: string) => {
    if (typeof submissionId !== 'string' || !submissionId) return
    const room = `submission:${submissionId}`
    socket.join(room)
    console.log(`[socket.io] ${socket.id} joined ${room}`)
    socket.emit('subscribed', { submissionId })
  })

  // Client leaves a submission's stream (e.g., after seeing the 'final' event).
  socket.on('unsubscribe', (submissionId: string) => {
    if (typeof submissionId !== 'string') return
    socket.leave(`submission:${submissionId}`)
  })

  // Generic ping for connection health.
  socket.on('ping', () => socket.emit('pong', { ts: Date.now() }))

  socket.on('disconnect', (reason) => {
    console.log(`[socket.io] client disconnected: ${socket.id} (${reason})`)
  })

  socket.on('error', (err) => {
    console.error(`[socket.io] ${socket.id} error:`, err)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[socket.io] AetherRun real-time service listening on port ${PORT}`)
})

// Graceful shutdown.
const shutdown = (signal: string) => {
  console.log(`[socket.io] received ${signal}, shutting down...`)
  io.close(() => {
    httpServer.close(() => process.exit(0))
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
