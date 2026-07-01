/**
 * ExecutionPanel — real-time execution log + per-test-case results + verdict.
 *
 * Driven by the Socket.io event stream from useSocket(). When no submission
 * is active, shows a placeholder with the engine state.
 */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { VerdictBadge } from './verdict-badge'
import type { SubmissionEvent } from '@/domain/types'
import type { SubmissionStatus, TestCaseStatus } from '@/domain/enums'
import { CheckCircle2, XCircle, Clock, AlertTriangle, Loader2, Terminal, ListChecks, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'

const TESTCASE_ICON: Record<TestCaseStatus, React.ReactNode> = {
  ACCEPTED: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
  WRONG_ANSWER: <XCircle className="w-3 h-3 text-rose-400" />,
  TLE: <Clock className="w-3 h-3 text-orange-400" />,
  MLE: <AlertTriangle className="w-3 h-3 text-purple-400" />,
  RTE: <AlertTriangle className="w-3 h-3 text-pink-400" />,
  SKIPPED: <div className="w-3 h-3 rounded-full border border-muted-foreground/40" />,
}

const TESTCASE_BG: Record<TestCaseStatus, string> = {
  ACCEPTED: 'bg-emerald-500/15 border-emerald-500/30',
  WRONG_ANSWER: 'bg-rose-500/15 border-rose-500/30',
  TLE: 'bg-orange-500/15 border-orange-500/30',
  MLE: 'bg-purple-500/15 border-purple-500/30',
  RTE: 'bg-pink-500/15 border-pink-500/30',
  SKIPPED: 'bg-muted/30 border-border',
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

  if (!submissionId) {
    return (
      <div className="flex flex-col h-full bg-card/20">
        <PanelHeader title="Execution" subtitle="Real-time logs" isLive={false} />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="text-muted-foreground text-sm space-y-2">
            <Terminal className="w-8 h-8 mx-auto opacity-50" />
            <p>Submit your solution to see real-time execution logs here.</p>
            <p className="text-[11px] font-mono opacity-70">
              Events are streamed via Socket.io from a separate worker process.
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

  return (
    <div className="flex flex-col h-full bg-card/20">
      <PanelHeader title="Execution" subtitle={submissionId.slice(-8)} isLive={isLive} />

      {/* Verdict banner */}
      {snapshot.currentStatus && (
        <div
          className={cn(
            'px-3 py-2.5 border-b border-border shrink-0',
            snapshot.currentStatus === 'ACCEPTED'
              ? 'bg-emerald-500/10'
              : ['TLE', 'MLE', 'RTE', 'WRONG_ANSWER', 'FAILED'].includes(snapshot.currentStatus)
              ? 'bg-rose-500/10'
              : 'bg-blue-500/10'
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <VerdictBadge status={snapshot.currentStatus} size="md" live={isLive} />
              {snapshot.finalResult && (
                <span className="text-[11px] font-mono text-muted-foreground">
                  {passed}/{total} test cases passed
                </span>
              )}
            </div>
            {snapshot.finalResult && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-blue-300">
                  <Clock className="w-3 h-3" />
                  {maxTime}ms
                </span>
                <span className="flex items-center gap-1 text-purple-300">
                  <Gauge className="w-3 h-3" />
                  {(maxMem / 1024).toFixed(1)}MB
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test case grid */}
      {snapshot.testCases.length > 0 && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1">
            <ListChecks className="w-3 h-3" />
            Test Cases
          </div>
          <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-8 lg:grid-cols-10 gap-1">
            {snapshot.testCases.map((tc) => (
              <div
                key={tc.order}
                title={`Case ${tc.order + 1}: ${tc.status} · ${tc.time}ms · ${(tc.mem / 1024).toFixed(1)}MB`}
                className={cn(
                  'aspect-square rounded border flex items-center justify-center text-[10px] font-mono font-bold transition-all',
                  TESTCASE_BG[tc.status]
                )}
              >
                {tc.order + 1}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compile output (if any) */}
      {snapshot.compileOutput && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="text-[10px] font-mono uppercase text-amber-400 tracking-wider mb-1">
            Compiler Output
          </div>
          <pre className="text-[11px] font-mono text-amber-300/80 bg-amber-500/5 p-2 rounded max-h-32 overflow-auto scrollbar-thin whitespace-pre-wrap break-all">
            {snapshot.compileOutput}
          </pre>
        </div>
      )}

      {/* Live log */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="p-3 space-y-1 font-mono text-[11px]">
          <div className="text-muted-foreground/60 mb-2">
            ── execution log ──────────────────────────────────
          </div>
          {events.map((ev, i) => (
            <LogLine key={i} event={ev} />
          ))}
          <div ref={logEndRef} />
        </div>
      </ScrollArea>
    </div>
  )
}

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
    <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 bg-card/40">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[120px]">
          {subtitle}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {isLive ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
            <span className="text-[10px] font-mono text-blue-400">LIVE</span>
          </>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground/60">IDLE</span>
        )}
      </div>
    </div>
  )
}

function LogLine({ event }: { event: SubmissionEvent }) {
  const ts = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })

  if (event.type === 'status') {
    return (
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground/50 shrink-0">{ts}</span>
        <span className="text-blue-400 shrink-0">[status]</span>
        <span className="text-foreground">
          → <VerdictBadge status={event.status ?? ''} size="sm" /> {event.message}
        </span>
      </div>
    )
  }
  if (event.type === 'compile') {
    return (
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground/50 shrink-0">{ts}</span>
        <span className="text-amber-400 shrink-0">[compile]</span>
        <span className="text-amber-300/80 truncate">{event.compileOutput?.slice(0, 100)}</span>
      </div>
    )
  }
  if (event.type === 'log') {
    return (
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground/50 shrink-0">{ts}</span>
        <span className="text-muted-foreground shrink-0">[log]</span>
        <span className="text-muted-foreground">{event.message}</span>
      </div>
    )
  }
  if (event.type === 'testcase' && event.testCase) {
    const tc = event.testCase
    return (
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground/50 shrink-0">{ts}</span>
        <span className="text-cyan-400 shrink-0">[test]</span>
        <span className="flex items-center gap-1.5">
          {TESTCASE_ICON[tc.status as TestCaseStatus]}
          <span className={cn(
            tc.status === 'ACCEPTED' ? 'text-emerald-400' :
            tc.status === 'SKIPPED' ? 'text-muted-foreground' :
            'text-rose-400'
          )}>
            {tc.status}
          </span>
          <span className="text-muted-foreground/60">
            · {tc.executionTime}ms · {(tc.memoryUsed / 1024).toFixed(1)}MB · exit={tc.exitCode}
          </span>
        </span>
      </div>
    )
  }
  if (event.type === 'final' && event.result) {
    return (
      <div className="flex items-start gap-2 mt-1 pt-1 border-t border-border">
        <span className="text-muted-foreground/50 shrink-0">{ts}</span>
        <span className="text-emerald-400 shrink-0">[final]</span>
        <span className="text-foreground">
          Verdict: <VerdictBadge status={event.result.status} size="sm" />
          <span className="text-muted-foreground/60 ml-2">
            {event.result.testCasesPassed}/{event.result.totalTestCases} passed
          </span>
        </span>
      </div>
    )
  }
  return null
}
