/**
 * Header — top bar with branding, a single live status indicator,
 * and the user picker.
 *
 * Design: minimal product header. No cluster of status pills (those
 * live in the bottom StatsBar now). Just:
 *   - Wordmark + tagline on the left
 *   - A single live connection dot in the middle (engine online)
 *   - User picker on the right
 *
 * The "engine online" indicator is the only status signal in the header —
 * it goes green when stats are flowing, dim when stale.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EngineStats, User } from '@/lib/api'
import { cn } from '@/lib/utils'

export function Header({
  users,
  currentUser,
  onUserChange,
  stats,
}: {
  users: User[]
  currentUser: User | null
  onUserChange: (u: User) => void
  stats: EngineStats | null
}) {
  // Engine is considered "online" if stats updated within the last 5s.
  // setState happens inside the interval callback (async), not in the
  // effect body — keeps react-hooks/set-state-in-effect happy.
  const [isLive, setIsLive] = useState(false)
  const lastStatsAtRef = useRef(0)
  useEffect(() => {
    if (stats) lastStatsAtRef.current = Date.now()
  }, [stats])
  useEffect(() => {
    const id = setInterval(() => {
      setIsLive(Date.now() - lastStatsAtRef.current < 5000)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="relative border-b border-border bg-sidebar/70 backdrop-blur-xl shrink-0 z-50 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/60 before:to-transparent">
      <div className="flex items-center justify-between h-14 px-5">
        {/* Wordmark */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/30 shadow-[0_0_18px_-4px] shadow-primary/60">
            {/* Logo mark — a stylized "Æ" made from two strokes */}
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d="M4 17 L12 4 L20 17 M7 12 L17 12 M6 17 L18 17"
                className="text-primary"
                stroke="url(#ae-grad)"
              />
              <defs>
                <linearGradient id="ae-grad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="oklch(0.72 0.19 295)" />
                  <stop offset="100%" stopColor="oklch(0.55 0.20 295)" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <h1 className="text-sm font-semibold tracking-tight truncate bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AetherRun
            </h1>
            <span className="text-[11px] text-muted-foreground/70 font-mono hidden sm:inline truncate">
              code execution engine
            </span>
          </div>
        </div>

        {/* Single live status indicator — engine online */}
        <div className={cn("hidden md:flex items-center gap-2 text-[11px] font-mono text-muted-foreground rounded-full border px-3 py-1 transition-colors", isLive ? "border-emerald-500/25 bg-emerald-500/5" : "border-border/60 bg-secondary/30")}>
          <span className="relative flex items-center justify-center w-1.5 h-1.5">
            <span
              className={cn(
                'absolute inline-flex w-1.5 h-1.5 rounded-full',
                isLive
                  ? 'bg-emerald-400 animate-pulse-live'
                  : 'bg-muted-foreground/40'
              )}
            />
          </span>
          <span className={isLive ? 'text-emerald-400/90' : ''}>
            {isLive ? 'engine online' : 'connecting…'}
          </span>
        </div>

        {/* User picker */}
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={currentUser?.id}
            onValueChange={(v) => {
              const u = users.find((u) => u.id === v)
              if (u) onUserChange(u)
            }}
          >
            <SelectTrigger className="h-9 w-[190px] text-xs gap-1.5 px-2.5 rounded-lg bg-secondary/40 hover:bg-secondary/70 border-border/60 hover:border-primary/40 transition-colors">
              <span className="flex items-center gap-2 min-w-0">
                <SelectValue placeholder="Select user…" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold font-mono shrink-0',
                        u.subscriptionTier === 'PREMIUM'
                          ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {u.username[0]?.toUpperCase()}
                    </span>
                    <span className="truncate">{u.username}</span>
                    {u.subscriptionTier === 'PREMIUM' && (
                      <span className="text-[10px] text-amber-300/80 font-mono ml-1">PRO</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  )
}
