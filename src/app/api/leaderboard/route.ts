/**
 * GET /api/leaderboard — top users by accepted submissions.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    // Group submissions by user, count ACCEPTED, sort desc.
    const users = await db.user.findMany({
      select: {
        id: true,
        username: true,
        subscriptionTier: true,
        submissions: {
          select: { status: true },
        },
      },
    })

    const leaderboard = users
      .map((u) => {
        const accepted = u.submissions.filter((s) => s.status === 'ACCEPTED').length
        const total = u.submissions.length
        return {
          id: u.id,
          username: u.username,
          tier: u.subscriptionTier,
          accepted,
          total,
          acceptanceRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
        }
      })
      .sort((a, b) => b.accepted - a.accepted || b.acceptanceRate - a.acceptanceRate)

    return NextResponse.json({ leaderboard })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
