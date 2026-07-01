/**
 * GET /api/users — list demo users (for the user picker in the UI).
 * POST /api/users/login — log in as a demo user (returns session token).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { login } from '@/services/AuthService'

export async function GET() {
  try {
    const users = await db.user.findMany({
      select: { id: true, username: true, email: true, subscriptionTier: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ users })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json() as { username?: string }
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 })
    }
    const session = await login(username)
    if (!session) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    return NextResponse.json({
      token: session.token,
      user: {
        id: session.userId,
        username: session.username,
        tier: session.tier,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
