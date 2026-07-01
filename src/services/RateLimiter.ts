/**
 * SlidingWindowRateLimiter — Redis-style sliding-window rate limiter.
 *
 * In production this would be `INCR` + `EXPIRE` on Redis sorted sets:
 *   ZADD ratelimit:<userId> <now> <unique>
 *   ZREMRANGEBYSCORE ratelimit:<userId> 0 <now - window>
 *   ZCARD ratelimit:<userId>
 *
 * Here we mirror that exact algorithm in-memory (per-process). For a
 * single-host demo this is fine; for a multi-host deployment you'd swap
 * in `ioredis` and the calling code wouldn't change.
 *
 * Algorithm: keep a sorted array of timestamps per key. On each request:
 *   1. Drop timestamps older than (now - window).
 *   2. If remaining count >= limit, reject.
 *   3. Otherwise, append the new timestamp and accept.
 */

interface RateLimitEntry {
  key: string
  timestamps: number[]
}

const DEFAULT_LIMIT = 5         // 5 submissions
const DEFAULT_WINDOW_MS = 60_000 // per minute

class SlidingWindowRateLimiterImpl {
  private store = new Map<string, RateLimitEntry>()

  /**
   * Check & record a hit. Returns true if allowed, false if rate-limited.
   */
  hit(key: string, limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS): {
    allowed: boolean
    remaining: number
    retryAfterMs: number
  } {
    const now = Date.now()
    const entry = this.store.get(key) ?? { key, timestamps: [] }

    // Drop expired timestamps.
    const cutoff = now - windowMs
    while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
      entry.timestamps.shift()
    }

    if (entry.timestamps.length >= limit) {
      const oldest = entry.timestamps[0]
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + windowMs - now,
      }
    }

    entry.timestamps.push(now)
    this.store.set(key, entry)
    return {
      allowed: true,
      remaining: limit - entry.timestamps.length,
      retryAfterMs: 0,
    }
  }

  /** Inspect the current count for a key WITHOUT consuming a slot. */
  peek(key: string): number {
    return this.store.get(key)?.timestamps.length ?? 0
  }

  /** Periodic cleanup — drops expired entries to prevent memory leaks. */
  cleanup(windowMs = DEFAULT_WINDOW_MS) {
    const cutoff = Date.now() - windowMs
    for (const [key, entry] of this.store.entries()) {
      while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
        entry.timestamps.shift()
      }
      if (entry.timestamps.length === 0) this.store.delete(key)
    }
  }
}

declare global {
   
  var __aetherRateLimiter: SlidingWindowRateLimiterImpl | undefined
}

export function getRateLimiter(): SlidingWindowRateLimiterImpl {
  if (!globalThis.__aetherRateLimiter) {
    globalThis.__aetherRateLimiter = new SlidingWindowRateLimiterImpl()
    // Sweep every 5 minutes.
    setInterval(() => globalThis.__aetherRateLimiter?.cleanup(), 5 * 60_000).unref?.()
  }
  return globalThis.__aetherRateLimiter
}

export { DEFAULT_LIMIT, DEFAULT_WINDOW_MS }
