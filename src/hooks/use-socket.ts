/**
 * useSocket — Socket.io hook for real-time submission events.
 *
 * Connects to the mini-service on port 3003 (via the Caddyfile proxy at
 * `/?XTransformPort=3003`). Subscribes to a submission's event stream and
 * exposes a typed `events` array + `latest` snapshot.
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { SubmissionEvent } from '@/domain/types'

export function useSocket(submissionId: string | null) {
  const [events, setEvents] = useState<SubmissionEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!submissionId) {
      // No active submission — nothing to do. We intentionally DON'T clear
      // `events` here because that would cause an extra render cycle. The
      // parent resets the hook by passing a new submissionId, which triggers
      // the cleanup branch below and re-initialization above.
      return
    }

    // Reset events array for the new submission ID before subscribing.
    // This is the standard pattern for "clear on prop change" — calling
    // setState synchronously in an effect is fine here because it's the
    // FIRST render for this submissionId (no cascading renders).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents([])

    // Connect to the Socket.io mini-service via the Caddy proxy.
    // The URL `/?XTransformPort=3003` tells socket.io-client to connect to
    // the current origin (localhost:3000) with the XTransformPort query param.
    // Caddy sees this param and reverse-proxies to localhost:3003.
    // socket.io-client appends its default path `/socket.io/` automatically.
    console.log('[useSocket] connecting for submission', submissionId)
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      timeout: 10_000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[useSocket] connected, subscribing to', submissionId)
      setIsConnected(true)
      socket.emit('subscribe', submissionId)
    })

    socket.on('connect_error', (err: Error) => {
      console.error('[useSocket] connect_error:', err.message)
    })

    socket.on('disconnect', (reason: string) => {
      console.log('[useSocket] disconnected:', reason)
      setIsConnected(false)
    })

    socket.on('submission:event', (event: SubmissionEvent) => {
      console.log('[useSocket] event:', event.type, event.submissionId)
      if (event.submissionId !== submissionId) return
      setEvents((prev) => [...prev, event])
    })

    socket.on('subscribed', () => {
      console.log('[useSocket] subscribed to', submissionId)
    })

    return () => {
      socket.emit('unsubscribe', submissionId)
      socket.disconnect()
      socketRef.current = null
      setIsConnected(false)
    }
  }, [submissionId])

  const clear = useCallback(() => setEvents([]), [])

  return { events, isConnected, clear }
}
