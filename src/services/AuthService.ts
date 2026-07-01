/**
 * Auth helper — minimal session management for the demo.
 *
 * Real production would use NextAuth with JWT cookies. For this portfolio
 * demo we use a simple in-memory session map keyed by a random token.
 * The token is sent as `Authorization: Bearer <token>` on every request.
 *
 * The login endpoint (POST /api/users/login) accepts {username} and returns
 * the matching user from the seed data + a session token.
 */
import { db } from '@/lib/db'
import { randomUUID } from 'crypto'

interface Session {
  token: string
  userId: string
  username: string
  tier: 'FREE' | 'PREMIUM'
  createdAt: number
}

declare global {
   
  var __aetherSessions: Map<string, Session> | undefined
}

function getSessions(): Map<string, Session> {
  if (!globalThis.__aetherSessions) {
    globalThis.__aetherSessions = new Map()
  }
  return globalThis.__aetherSessions
}

export async function login(username: string): Promise<Session | null> {
  const user = await db.user.findUnique({ where: { username } })
  if (!user) return null
  const session: Session = {
    token: randomUUID(),
    userId: user.id,
    username: user.username,
    tier: user.subscriptionTier as 'FREE' | 'PREMIUM',
    createdAt: Date.now(),
  }
  getSessions().set(session.token, session)
  return session
}

export function getSession(token: string | null | undefined): Session | null {
  if (!token) return null
  const t = token.startsWith('Bearer ') ? token.slice(7) : token
  return getSessions().get(t) ?? null
}

/**
 * Resolve the user for an incoming request. Strategy:
 *   1. Check `Authorization: Bearer <token>` header.
 *   2. If missing, fall back to a `userId` query param (dev convenience).
 *   3. If neither, return the first user in the DB (demo convenience).
 */
export async function resolveUser(req: Request): Promise<{ id: string; username: string; tier: 'FREE' | 'PREMIUM' } | null> {
  const authHeader = req.headers.get('authorization')
  const session = getSession(authHeader)
  if (session) {
    return { id: session.userId, username: session.username, tier: session.tier }
  }
  const url = new URL(req.url)
  const userId = url.searchParams.get('userId')
  if (userId) {
    const u = await db.user.findUnique({ where: { id: userId } })
    if (u) return { id: u.id, username: u.username, tier: u.subscriptionTier as 'FREE' | 'PREMIUM' }
  }
  // Fallback: first user (demo convenience — keeps the UI functional without auth)
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (u) return { id: u.id, username: u.username, tier: u.subscriptionTier as 'FREE' | 'PREMIUM' }
  return null
}
