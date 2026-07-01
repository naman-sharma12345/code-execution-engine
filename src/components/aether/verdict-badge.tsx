/**
 * VerdictBadge — refined status chip.
 *
 * Design: a small leading dot in the status color, then a short label.
 * Not a heavy pill — borders are quiet, type is sentence-case (not
 * upper-tracking-widest). The dot is the primary status signal.
 *
 * The color comes from STATUS_COLORS in @/domain/enums so the palette
 * is identical between API, worker, and UI.
 */
'use client'

import { cn } from '@/lib/utils'
import { STATUS_COLORS, type SubmissionStatus } from '@/domain/enums'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  COMPILING: 'Compiling',
  RUNNING: 'Running',
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  TLE: 'Time Limit',
  MLE: 'Memory Limit',
  RTE: 'Runtime Error',
  FAILED: 'Failed',
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
    sm: 'text-[10px] gap-1 py-0.5 pl-1.5 pr-2',
    md: 'text-[11px] gap-1.5 py-0.5 pl-2 pr-2.5',
    lg: 'text-xs gap-1.5 py-1 pl-2.5 pr-3',
  }

  const dotSize = {
    sm: 'w-1.5 h-1.5',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-mono font-medium tabular-nums',
        'border transition-colors',
        sizeClasses[size]
      )}
      style={{
        color: color,
        backgroundColor: `${color}14`, // ~8% alpha
        borderColor: `${color}33`,     // ~20% alpha
      }}
    >
      <span
        className={cn(
          'inline-block rounded-full shrink-0',
          dotSize[size],
          live && 'animate-pulse-live'
        )}
        style={{
          backgroundColor: color,
          boxShadow: live ? `0 0 6px ${color}` : undefined,
        }}
      />
      {label}
    </span>
  )
}
