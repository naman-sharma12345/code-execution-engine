/**
 * StatsBar — bottom strip with engine stats.
 *
 * Design: clean, four metrics max — Queue depth · Workers busy · Uptime ·
 * Total processed. Mono font, subtle dot separators, no busy groups.
 *
 * Polls /api/stats every 2s for live updates.
 */
'use client'

import { useEffect, useState } from 'react'
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
      <footer className="border-t border-border bg-sidebar/40 h-7 px-3 flex items-center text-[10px] font-mono text-muted-foreground/60">
        loading engine stats…
      </footer>
    )
  }

  // Four core metrics — no clutter.
  const queueDepth = stats.queue.waiting + stats.queue.active + stats.queue.delayed
  const workersBusy = stats.workers.busy
  const totalProcessed = stats.throughput.processed

  return (
    <footer className="border-t border-border bg-sidebar/70 backdrop-blur-md h-8 px-4 shrink-0 flex items-center overflow-x-auto scrollbar-xfine">
      <div className="flex items-center gap-5 text-[10px] font-mono text-muted-foreground/70 terminal-text whitespace-nowrap">
        <Metric
          label="Queue"
          value={queueDepth}
          suffix={stats.queue.active > 0 ? `${stats.queue.active} active` : 'idle'}
          tone={stats.queue.active > 0 ? 'active' : 'default'}
        />
        <Sep />
        <Metric
          label="Workers"
          value={workersBusy}
          suffix={`${stats.workers.count} total`}
          tone={workersBusy > 0 ? 'active' : 'default'}
        />
        <Sep />
        <Metric
          label="Processed"
          value={totalProcessed}
          suffix={`${stats.throughput.lastHourAccepted}✓ / ${stats.throughput.lastHourRejected}✗ 1h`}
          tone="default"
        />
        <Sep />
        <Metric
          label="Uptime"
          value={formatUptime(stats.uptimeMs)}
          suffix={`avg ${stats.throughput.avgLatencyMs}ms`}
          tone="default"
        />
        {stats.queue.failed > 0 && (
          <>
            <Sep />
            <Metric
              label="DLQ"
              value={stats.queue.failed}
              suffix="failed"
              tone="danger"
            />
          </>
        )}
      </div>
    </footer>
  )
}

function Metric({
  label,
  value,
  suffix,
  tone = 'default',
}: {
  label: string
  value: number | string
  suffix?: string
  tone?: 'default' | 'active' | 'danger'
}) {
  const valueColor =
    tone === 'danger'
      ? 'text-rose-400'
      : tone === 'active'
      ? 'text-primary'
      : 'text-foreground/90'
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-muted-foreground/55 uppercase tracking-wider text-[9px]">
        {label}
      </span>
      <span className={cn('font-semibold tabular-nums', valueColor)}>{value}</span>
      {suffix && (
        <span className="text-muted-foreground/45 tabular-nums">{suffix}</span>
      )}
    </div>
  )
}

function Sep() {
  return <span className="text-muted-foreground/25 select-none">·</span>
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
