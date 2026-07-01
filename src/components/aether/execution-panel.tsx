/**
 * ExecutionPanel — real-time execution log + per-test-case results + verdict.
 *
 * Design:
 *   - "Wow" panel: looks like a real IDE output / terminal panel.
 *   - Verdict banner is a full-width colored bar with the status label
 *     large and clear.
 *   - Test case results are a horizontal strip of numbered cells; passed
 *     cells are filled with the status color, failed cells are red.
 *   - Live log looks like a terminal: monospace, subtle line numbers,
 *     colored event-type tags ([status] [compile] [test] [final]).
 *   - Empty state is inviting — shows what the panel will display.
 *
 * Driven by the SubmissionEvent stream from useSubmissionStream().
 */
'use client'

import { useEffect, useMemo, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { VerdictBadge } from './verdict-badge'
import { STATUS_COLORS, type SubmissionStatus, type TestCaseStatus } from '@/domain/enums'
import type { SubmissionEvent } from '@/domain/types'
import { Terminal, Clock, Cpu, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const TESTCASE_BORDER: Record<TestCaseStatus, string> = {
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  WRONG_ANSWER: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  TLE: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
  MLE: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  RTE: 'border-pink-500/40 bg-pink-500/15 text-pink-300',
  SKIPPED: 'border-border bg-muted/40 text-muted-foreground/70',
}

export function ExecutionPanel({
  events,
  isLive,
  submissionId,
}: {
  events: SubmissionEvent[]
  isLive: boolean
  submissionId: string | null
}) {
  const logEndRef = useRef<HTMLDivElement>(null)

  // Build a snapshot from the event stream — latest status + per-test-case results.
  const snapshot = useMemo(() => {
    let currentStatus: SubmissionStatus | null = null
    const testCases: { order: number; status: TestCaseStatus; time: number; mem: number; isHidden?: boolean }[] = []
    let compileOutput: string | null = null
    let finalResult: SubmissionEvent['result'] | null = null
    let testCaseCounter = 0

    for (const ev of events) {
      if (ev.type === 'status' && ev.status) currentStatus = ev.status
      if (ev.type === 'compile' && ev.compileOutput) compileOutput = ev.compileOutput
      if (ev.type === 'testcase' && ev.testCase) {
        testCases.push({
          order: testCaseCounter++,
          status: ev.testCase.status,
          time: ev.testCase.executionTime,
          mem: ev.testCase.memoryUsed,
        })
      }
      if (ev.type === 'final' && ev.result) {
        finalResult = ev.result
        currentStatus = ev.result.status
      }
    }

    return { currentStatus, testCases, compileOutput, finalResult }
  }, [events])

  // Auto-scroll log to bottom on new events.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  // ─── Empty state ──────────────────────────────────────────────────
  if (!submissionId) {
    return (
      <div className="flex flex-col h-full bg-card/20">
        <PanelHeader title="Execution" subtitle="output" isLive={false} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-[260px]">
            <div className="relative inline-flex items-center justify-center w-12 h-12 rounded-xl bg-secondary/40 border border-border/60 mb-4">
              <Terminal className="w-5 h-5 text-muted-foreground/70" />
              {/* Three quiet "terminal dots" above the icon */}
              <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex gap-1">
                <span className="w-1 h-1 rounded-full bg-rose-500/50" />
                <span className="w-1 h-1 rounded-full bg-amber-500/50" />
                <span className="w-1 h-1 rounded-full bg-emerald-500/50" />
              </div>
            </div>
            <p className="text-sm font-medium text-foreground/90">
              No active submission
            </p>
            <p className="text-[12px] text-muted-foreground/70 mt-1.5 leading-relaxed">
              Write a solution and hit{' '}
              <kbd className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary/70 border border-border/60 text-foreground/90">
                ⌘⏎
              </kbd>{' '}
              to stream live execution logs, per-test-case results, and a verdict here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const passed = snapshot.testCases.filter((tc) => tc.status === 'ACCEPTED').length
  const total = snapshot.testCases.length
  const maxTime = Math.max(0, ...snapshot.testCases.map((tc) => tc.time))
  const maxMem = Math.max(0, ...snapshot.testCases.map((tc) => tc.mem))

  const verdictColor = snapshot.currentStatus
    ? STATUS_COLORS[snapshot.currentStatus] ?? '#6b7280'
    : null

  // Verdict banner tone — terminal-style, color-coded by verdict family
  const bannerTone =
    snapshot.currentStatus === 'ACCEPTED'
      ? 'from-emerald-500/12 to-transparent border-emerald-500/25'
      : snapshot.currentStatus &&
        ['TLE', 'MLE', 'RTE', 'WRONG_ANSWER', 'FAILED'].includes(snapshot.currentStatus)
      ? 'from-rose-500/12 to-transparent border-rose-500/25'
      : 'from-primary/10 to-transparent border-primary/25'

  return (
    <div className="flex flex-col h-full bg-card/20">
      <PanelHeader title="Execution" subtitle={submissionId.slice(-8)} isLive={isLive} />

      {/* ─── Verdict banner ───────────────────────────────────────── */}
      {snapshot.currentStatus && (
        <div
          className={cn(
            'relative px-4 py-3 border-b shrink-0 bg-gradient-to-r overflow-hidden',
            bannerTone
          )}
        >
          {/* Live sweep animation while running */}
          {isLive && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div
                className="absolute inset-y-0 -left-1/3 w-1/3 animate-sweep"
                style={{
                  background: `linear-gradient(90deg, transparent, ${verdictColor}22, transparent)`,
                }}
              />
            </div>
          )}
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <VerdictIcon status={snapshot.currentStatus} live={isLive} />
              <div className="min-w-0">
                <VerdictBadge status={snapshot.currentStatus} size="md" live={isLive} />
                {snapshot.finalResult && (
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                    <span className="tabular-nums text-foreground/80">{passed}</span>
                    <span className="text-muted-foreground/50"> / {total} test cases passed</span>
                  </div>
                )}
              </div>
            </div>
            {snapshot.finalResult && (
              <div className="flex items-center gap-3 text-[11px] font-mono shrink-0">
                <span className="flex items-center gap-1 text-cyan-300/90">
                  <Clock className="w-3 h-3" />
                  <span className="tabular-nums">{maxTime}ms</span>
                </span>
                <span className="flex items-center gap-1 text-violet-300/90">
                  <Cpu className="w-3 h-3" />
                  <span className="tabular-nums">{(maxMem / 1024).toFixed(1)}MB</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Test case strip ──────────────────────────────────────── */}
      {snapshot.testCases.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center justify-between">
            <span>Test Results</span>
            <span className="tabular-nums text-muted-foreground/55">
              {passed}/{total} passed
            </span>
          </div>
          <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-8 lg:grid-cols-9 gap-1">
            {snapshot.testCases.map((tc) => (
              <div
                key={tc.order}
                title={`Case ${tc.order + 1}: ${tc.status} · ${tc.time}ms · ${(tc.mem / 1024).toFixed(1)}MB`}
                className={cn(
                  'aspect-square rounded border flex items-center justify-center text-[10px] font-mono font-semibold transition-all tabular-nums',
                  TESTCASE_BORDER[tc.status]
                )}
              >
                {tc.order + 1}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Compiler output (if any) ─────────────────────────────── */}
      {snapshot.compileOutput && (
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400/90 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Compiler Output
          </div>
          <pre className="text-[11px] font-mono text-amber-200/80 bg-amber-500/5 border border-amber-500/15 p-2 rounded max-h-32 overflow-auto scrollbar-xfine whitespace-pre-wrap break-words terminal-text">
            {snapshot.compileOutput}
          </pre>
        </div>
      )}

      {/* ─── Live log ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 scrollbar-xfine">
        <div className="px-3 py-2.5 font-mono text-[11px] terminal-text">
          <div className="flex items-center gap-2 text-muted-foreground/50 mb-2 select-none">
            <span className="text-muted-foreground/40">─────────</span>
            <span className="text-[10px] uppercase tracking-wider">execution log</span>
            <span className="text-muted-foreground/40 flex-1">─────────</span>
          </div>
          <div className="space-y-0.5">
            {events.map((ev, i) => (
              <LogLine key={i} event={ev} lineNumber={i + 1} />
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

/* ─── Panel header ──────────────────────────────────────────────────── */
function PanelHeader({
  title,
  subtitle,
  isLive,
}: {
  title: string
  subtitle: string
  isLive: boolean
}) {
  return (
    <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0 bg-sidebar/40">
      <div className="flex items-center gap-2 min-w-0">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/50 truncate max-w-[120px]">
          #{subtitle}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isLive ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-[10px] font-mono text-primary uppercase tracking-wider">
              Live
            </span>
          </>
        ) : (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
              Idle
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Verdict icon ──────────────────────────────────────────────────── */
function VerdictIcon({
  status,
  live,
}: {
  status: SubmissionStatus
  live: boolean
}) {
  if (status === 'ACCEPTED') {
    return (
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      </div>
    )
  }
  if (['WRONG_ANSWER', 'TLE', 'MLE', 'RTE', 'FAILED'].includes(status)) {
    return (
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30">
        <XCircle className="w-4 h-4 text-rose-400" />
      </div>
    )
  }
  // In-flight: pending / compiling / running
  return (
    <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/12 border border-primary/30">
      <Loader2 className={cn('w-4 h-4 text-primary', live && 'animate-spin')} />
    </div>
  )
}

/* ─── Log line ──────────────────────────────────────────────────────── */
function LogLine({
  event,
  lineNumber,
}: {
  event: SubmissionEvent
  lineNumber: number
}) {
  const ts = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })

  return (
    <div className="flex items-start gap-2 leading-relaxed">
      <span className="text-muted-foreground/30 select-none w-5 text-right shrink-0 tabular-nums">
        {lineNumber}
      </span>
      <span className="text-muted-foreground/45 shrink-0 tabular-nums">{ts}</span>

      {event.type === 'status' && (
        <>
          <Tag color="primary">status</Tag>
          <span className="text-foreground/85 truncate">
            <span className="text-muted-foreground/60">→ </span>
            {event.message}
          </span>
        </>
      )}

      {event.type === 'compile' && (
        <>
          <Tag color="amber">compile</Tag>
          <span className="text-amber-200/80 truncate">
            {event.compileOutput?.slice(0, 120)}
          </span>
        </>
      )}

      {event.type === 'log' && (
        <>
          <Tag color="muted">log</Tag>
          <span className="text-muted-foreground/80">{event.message}</span>
        </>
      )}

      {event.type === 'testcase' && event.testCase && (
        <TestCaseLogLine testCase={event.testCase} />
      )}

      {event.type === 'final' && event.result && (
        <>
          <Tag color="emerald">final</Tag>
          <span className="text-foreground/85 flex items-center gap-1.5 flex-wrap">
            <span className="text-muted-foreground/60">verdict</span>
            <VerdictBadge status={event.result.status} size="sm" />
            <span className="text-muted-foreground/60 tabular-nums">
              · {event.result.testCasesPassed}/{event.result.totalTestCases}
            </span>
          </span>
        </>
      )}
    </div>
  )
}

function TestCaseLogLine({
  testCase,
}: {
  testCase: NonNullable<SubmissionEvent['testCase']>
}) {
  const statusColor = STATUS_COLORS[testCase.status] ?? '#6b7280'
  return (
    <>
      <Tag color="cyan">test</Tag>
      <span className="flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span style={{ color: statusColor }} className="font-medium">
          {testCase.status}
        </span>
        <span className="text-muted-foreground/60 tabular-nums">
          · {testCase.executionTime}ms · {(testCase.memoryUsed / 1024).toFixed(1)}MB · exit={testCase.exitCode}
        </span>
      </span>
    </>
  )
}

function Tag({
  color,
  children,
}: {
  color: 'primary' | 'amber' | 'cyan' | 'emerald' | 'muted'
  children: React.ReactNode
}) {
  const colors = {
    primary: 'text-primary/80 bg-primary/8 border-primary/20',
    amber: 'text-amber-300/80 bg-amber-500/8 border-amber-500/20',
    cyan: 'text-cyan-300/80 bg-cyan-500/8 border-cyan-500/20',
    emerald: 'text-emerald-300/80 bg-emerald-500/8 border-emerald-500/20',
    muted: 'text-muted-foreground/70 bg-muted/30 border-border/60',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 rounded border text-[10px] font-mono shrink-0',
        colors[color]
      )}
    >
      {children}
    </span>
  )
}
