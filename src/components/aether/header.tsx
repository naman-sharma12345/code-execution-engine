/**
 * Header — top bar with branding, user picker, and live engine status.
 */
'use client'

import { useEffect, useState } from 'react'
import { Activity, Cpu, Zap, Server } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EngineStats, User } from '@/lib/api'

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
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center justify-between px-4 py-2.5 gap-4">
        {/* Logo + title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-primary" fill="currentColor" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse-live" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight truncate">
              AetherRun
            </h1>
            <p className="text-[10px] text-muted-foreground font-mono truncate">
              distributed code execution engine
            </p>
          </div>
        </div>

        {/* Engine status pills */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono">
          <StatusPill
            icon={<Server className="w-3 h-3" />}
            label="QUEUE"
            value={stats ? `${stats.queue.waiting}w / ${stats.queue.active}a` : '—'}
            color={stats && stats.queue.active > 0 ? 'blue' : 'muted'}
          />
          <StatusPill
            icon={<Cpu className="w-3 h-3" />}
            label="WORKERS"
            value={stats ? `${stats.workers.busy}/${stats.workers.count} busy` : '—'}
            color={stats && stats.workers.busy > 0 ? 'blue' : 'emerald'}
          />
          <StatusPill
            icon={<Activity className="w-3 h-3" />}
            label="POOL"
            value={stats ? `${stats.containerPool.idle}/${stats.containerPool.total}` : '—'}
            color="emerald"
          />
          <StatusPill
            icon={<Zap className="w-3 h-3" />}
            label="DONE"
            value={stats ? `${stats.throughput.processed}` : '—'}
            color="emerald"
          />
        </div>

        {/* User picker */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[10px] text-muted-foreground font-mono hidden sm:block">USER</div>
          <Select
            value={currentUser?.id}
            onValueChange={(v) => {
              const u = users.find((u) => u.id === v)
              if (u) onUserChange(u)
            }}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs font-mono">
              <SelectValue placeholder="Select user…" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs font-mono">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        u.subscriptionTier === 'PREMIUM' ? 'bg-amber-400' : 'bg-muted-foreground'
                      }`}
                    />
                    {u.username}
                    <span className="text-[10px] text-muted-foreground">
                      ({u.subscriptionTier})
                    </span>
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

function StatusPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'emerald' | 'blue' | 'amber' | 'muted'
}) {
  const colorClasses = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    muted: 'text-muted-foreground bg-muted/30 border-border',
  }
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${colorClasses[color]}`}
    >
      {icon}
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
