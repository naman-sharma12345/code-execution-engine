/**
 * POST /api/submissions — submit code for execution.
 * GET  /api/submissions — list recent submissions.
 *
 * Flow:
 *   1. Resolve the user (auth header OR fallback to first user for demo).
 *   2. Apply rate limiting (5 submissions / minute per user).
 *   3. Validate the payload.
 *   4. Persist submission + enqueue into the priority queue.
 *   5. Return the submission ID — the client then connects to Socket.io
 *      on port 3003 to receive real-time status updates.
 */
import { NextRequest, NextResponse } from 'next/server'
import { ensureEngineStarted } from '@/services/EngineBootstrap'
import { submissionService } from '@/services/SubmissionService'
import { getRateLimiter } from '@/services/RateLimiter'
import { resolveUser } from '@/services/AuthService'
import type { Language } from '@/domain/enums'

// Wake up the engine on cold start.
ensureEngineStarted()

export async function POST(req: NextRequest) {
  try {
    const user = await resolveUser(req)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Rate limit: 5 submissions / minute per user (FREE & PREMIUM same for demo).
    const rl = getRateLimiter().hit(`submit:${user.id}`)
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `Too many submissions. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
          retryAfterMs: rl.retryAfterMs,
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await req.json()
    const { problemId, language, code } = body as {
      problemId?: string
      language?: Language
      code?: string
    }

    if (!problemId || !language || !code) {
      return NextResponse.json(
        { error: 'Missing required fields: problemId, language, code' },
        { status: 400 }
      )
    }

    const { submissionId, priority } = await submissionService.create({
      problemId,
      userId: user.id,
      language,
      code,
    })

    return NextResponse.json({
      submissionId,
      priority,
      tier: user.tier,
      streamUrl: `/api/submissions/${submissionId}/stream`,
      message: 'Submission enqueued. Open the stream URL for real-time updates.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/submissions]', msg)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)
    const submissions = await submissionService.listRecent(limit)
    return NextResponse.json({ submissions })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
