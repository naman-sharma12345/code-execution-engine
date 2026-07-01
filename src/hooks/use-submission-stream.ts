/**
 * useSubmissionStream — Server-Sent Events hook for real-time submission events.
 *
 * Replaces the Socket.io hook. SSE is simpler and more reliable in this
 * environment because it runs natively inside Next.js — no separate service
 * to manage, no port conflicts, no proxy configuration.
 *
 * Flow:
 *   1. Client opens `new EventSource('/api/submissions/<id>/stream')`.
 *   2. The API route flushes buffered events first (so late clients see
 *      the full history), then streams live events.
 *   3. On 'final' event, the route closes the stream.
 *   4. EventSource auto-reconnects on network drops.
 */
'use client'

import { useEffect, useState } from 'react'
import type { SubmissionEvent } from '@/domain/types'

export function useSubmissionStream(submissionId: string | null) {
  const [events, setEvents] = useState<SubmissionEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!submissionId) {
      return
    }

    // Reset events for the new submission.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents([])

    const url = `/api/submissions/${submissionId}/stream`
    const es = new EventSource(url)

    es.onopen = () => setIsConnected(true)
    es.onerror = () => {
      // EventSource auto-reconnects; we just update the connected flag.
      setIsConnected(false)
    }

    es.onmessage = (e) => {
      try {
        const event: SubmissionEvent = JSON.parse(e.data)
        if (event.submissionId !== submissionId) return
        setEvents((prev) => [...prev, event])
      } catch {
        // ignore malformed frames
      }
    }

    es.addEventListener('done', () => {
      es.close()
      setIsConnected(false)
    })

    return () => {
      es.close()
      setIsConnected(false)
    }
  }, [submissionId])

  return { events, isConnected }
}
