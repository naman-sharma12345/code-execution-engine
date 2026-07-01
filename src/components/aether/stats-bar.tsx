/**
 * StatsBar — bottom strip with engine stats (queue, workers, pool, throughput).
 *
 * Polls /api/stats every 2s for live updates. Designed to look like a
 * "monitoring dashboard" strip — common in dev-tools UIs.
 */
'use client'

import { useEffect, useState } from 'react'
import { Database, Layers, Cpu, Zap, Activity, Timer } from 'lucide-react'
import { api, type EngineStats } from '@/lib/api'
import { cn } from '@/lib/utils'

export function StatsBar() {
  const [stats, setStats] = useState<EngineStats | null>(null)

  useEffect(() => {
    let mounted = true
    const poll = async () => {
      try {
        const s = await api.getStats()
        if (mounted) setStats(s)
      } catch {
        // ignore — stats are best-effort
      }
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (!stats) {
    return (
      <footer className="border-t border-border bg-card/40 px-3 py-1.5 text-[10px] font-mono text-muted-foreground">
        Loading engine stats…
      </footer>
    )
  }

  return (
    <footer className="border-t border-border bg-card/50 backdrop-blur-sm px-3 py-1.5 shrink-0">
      <div className="flex items-center gap-4 text-[10px] font-mono overflow-x-auto scrollbar-thin">
        <StatGroup icon={<Layers className="w-3 h-3" />} label="QUEUE" color="text-blue-300">
          <Stat label="waiting" value={stats.queue.waiting} highlight={stats.queue.waiting > 0} />
          <Stat label="active" value={stats.queue.active} highlight={stats.queue.active > 0} />
          <Stat label="delayed" value={stats.queue.delayed} />
          <Stat label="DLQ" value={stats.queue.failed} highlight={stats.queue.failed > 0} danger />
          <Stat label="done" value={stats.queue.completed} />
        </StatGroup>

        <Divider />

        <StatGroup icon={<Cpu className="w-3 h-3" />} label="WORKERS" color="text-emerald-300">
          <Stat label="busy" value={stats.workers.busy} highlight={stats.workers.busy > 0} />
          <Stat label="idle" value={stats.workers.idle} />
          <Stat label="total" value={stats.workers.count} />
        </StatGroup>

        <Divider />

        <StatGroup icon={<Database className="w-3 h-3" />} label="POOL" color="text-purple-300">
          <Stat label="idle" value={stats.containerPool.idle} />
          <Stat label="in-use" value={stats.containerPool.inUse} highlight={stats.containerPool.inUse > 0} />
          <Stat label="total" value={stats.containerPool.total} />
        </StatGroup>

        <Divider />

        <StatGroup icon={<Activity className="w-3 h-3" />} label="THROUGHPUT" color="text-amber-300">
          <Stat label="processed" value={stats.throughput.processed} />
          <Stat label="1h ✓" value={stats.throughput.lastHourAccepted} />
          <Stat label="1h ✗" value={stats.throughput.lastHourRejected} danger={stats.throughput.lastHourRejected > 0} />
        </StatGroup>

        <Divider />

        <div className="flex items-center gap-1.5 shrink-0">
          <Timer className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground/70">UPTIME</span>
          <span className="text-foreground font-semibold">{formatUptime(stats.uptimeMs)}</span>
        </div>
      </div>
    </footer>
  )
}

function StatGroup({
  icon,
  label,
  color,
  children,
}: {
  icon: React.ReactNode
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className={color}>{icon}</span>
      <span className={cn('font-semibold', color)}>{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight = false,
  danger = false,
}: {
  label: string
  value: number
  highlight?: boolean
  danger?: boolean
}) {
  return (
    <span className="flex items-center gap-0.5">
      <span className="text-muted-foreground/60">{label}</span>
      <span
        className={cn(
          'font-semibold',
          danger
            ? 'text-rose-400'
            : highlight
            ? 'text-blue-400'
            : 'text-foreground'
        )}
      >
        {value}
      </span>
    </span>
  )
}

function Divider() {
  return <span className="text-muted-foreground/30 shrink-0">|</span>
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
