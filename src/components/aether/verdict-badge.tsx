/**
 * VerdictBadge — colored pill that shows a submission/test-case status.
 * Uses the centralized STATUS_COLORS from the domain layer so the palette
 * is identical between API, worker, and UI.
 */
'use client'

import { cn } from '@/lib/utils'
import { STATUS_COLORS, type SubmissionStatus } from '@/domain/enums'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'PENDING',
  COMPILING: 'COMPILING',
  RUNNING: 'RUNNING',
  ACCEPTED: 'ACCEPTED',
  WRONG_ANSWER: 'WRONG ANSWER',
  TLE: 'TIME LIMIT',
  MLE: 'MEMORY LIMIT',
  RTE: 'RUNTIME ERROR',
  FAILED: 'FAILED',
}

export function VerdictBadge({
  status,
  size = 'md',
  live = false,
}: {
  status: string
  size?: 'sm' | 'md' | 'lg'
  live?: boolean
}) {
  const color = STATUS_COLORS[status as SubmissionStatus] ?? '#6b7280'
  const label = STATUS_LABELS[status] ?? status

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  }

  // Glow class based on status color family
  const glowClass = live
    ? status === 'ACCEPTED'
      ? 'glow-emerald'
      : status === 'RUNNING' || status === 'COMPILING'
      ? 'glow-blue'
      : ['TLE', 'MLE', 'RTE', 'WRONG_ANSWER', 'FAILED'].includes(status)
      ? 'glow-red'
      : ''
    : ''

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-mono font-semibold tracking-wider uppercase',
        sizeClasses[size],
        glowClass
      )}
      style={{
        color,
        backgroundColor: `${color}20`,
        border: `1px solid ${color}40`,
      }}
    >
      {live && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-live"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </span>
  )
}
