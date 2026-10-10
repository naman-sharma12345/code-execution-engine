/**
 * ProblemSidebar — left rail with problems list, leaderboard, submission history.
 *
 * Design:
 *   - Section headers are quiet (small caps, mono, muted) — they label
 *     groups, not demand attention.
 *   - Problem rows show a difficulty DOT (not text) — color is enough.
 *     Selected problem gets a 2px violet left-rail.
 *   - Leaderboard is compact: rank number + username + accepted count.
 *   - Recent submissions: problem title + verdict dot + small metadata.
 *   - Each section can collapse independently.
 */
'use client'

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VerdictBadge } from './verdict-badge'
import { STATUS_COLORS, type SubmissionStatus } from '@/domain/enums'
import type { ProblemListItem, SubmissionListItem, LeaderboardEntry } from '@/lib/api'

const DIFFICULTY_DOT: Record<string, string> = {
  EASY: 'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  HARD: 'bg-rose-400',
}

export function ProblemSidebar({
  problems,
  selectedProblemId,
  onSelectProblem,
  leaderboard,
  recentSubmissions,
  onSelectSubmission,
}: {
  problems: ProblemListItem[]
  selectedProblemId: string | null
  onSelectProblem: (id: string) => void
  leaderboard: LeaderboardEntry[]
  recentSubmissions: SubmissionListItem[]
  onSelectSubmission: (id: string) => void
}) {
  return (
    <aside className="w-72 border-r border-border bg-sidebar/40 flex flex-col shrink-0">
      <ScrollArea className="flex-1 scrollbar-xfine">
        <div className="py-2">
          {/* Problems list */}
          <Section title="Problems" count={problems.length} defaultOpen>
            <div className="space-y-px px-1.5">
              {problems.length === 0 && (
                <p className="text-[11px] text-muted-foreground/60 italic px-2.5 py-3">
                  No problems loaded.
                </p>
              )}
              {problems.map((p) => {
                const isActive = selectedProblemId === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectProblem(p.id)}
                    className={cn(
                      'group w-full text-left pl-3.5 pr-2.5 py-2.5 rounded-lg text-xs transition-all duration-150 relative',
                      isActive
                        ? 'bg-gradient-to-r from-primary/20 to-primary/5 text-foreground ring-1 ring-primary/25 shadow-[0_2px_14px_-6px] shadow-primary/50'
                        : 'text-foreground/85 hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5'
                    )}
                  >
                    {/* Active rail */}
                    <span
                      className={cn(
                        'absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors',
                        isActive ? 'bg-primary' : 'bg-transparent'
                      )}
                    />
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Difficulty dot */}
                      <span
                        className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                          DIFFICULTY_DOT[p.difficulty] ?? 'bg-muted-foreground'
                        )}
                        title={p.difficulty}
                      />
                      <span className="font-medium truncate flex-1">{p.title}</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 tabular-nums">
                        {p.totalTestCases}
                      </span>
                    </div>
                    {/* Hover-only metadata — keeps the row clean by default */}
                    <div className="flex items-center gap-1.5 mt-0.5 pl-3.5 text-[10px] text-muted-foreground/55 font-mono">
                      <span>{p.timeLimit}ms</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span>{p.memoryLimit}MB</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Leaderboard */}
          <Section title="Leaderboard" count={leaderboard.length} defaultOpen>
            <div className="space-y-px px-1.5">
              {leaderboard.slice(0, 8).map((u, i) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-mono font-semibold shrink-0 tabular-nums',
                      i === 0
                        ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25'
                        : i === 1
                        ? 'bg-slate-400/15 text-slate-300 ring-1 ring-slate-400/20'
                        : i === 2
                        ? 'bg-orange-600/15 text-orange-300 ring-1 ring-orange-600/25'
                        : 'text-muted-foreground/70'
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium truncate">{u.username}</span>
                      {u.tier === 'PREMIUM' && (
                        <span className="inline-block w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono font-medium tabular-nums">
                      {u.accepted}
                      <span className="text-muted-foreground/50">/{u.total}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                      {u.acceptanceRate}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Recent submissions */}
          <Section
            title="Recent Submissions"
            count={recentSubmissions.length}
            defaultOpen
          >
            <div className="space-y-px px-1.5 pb-3">
              {recentSubmissions.length === 0 && (
                <p className="text-[11px] text-muted-foreground/60 italic px-2.5 py-3">
                  No submissions yet — submit a solution to populate this list.
                </p>
              )}
              {recentSubmissions.map((s) => {
                const dotColor = STATUS_COLORS[s.status as SubmissionStatus] ?? '#6b7280'
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelectSubmission(s.id)}
                    className="group w-full text-left px-2.5 py-1.5 rounded-md hover:bg-accent/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="text-[12px] font-medium truncate flex-1">
                        {s.problem.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 tabular-nums">
                        {s.executionTime}ms
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 pl-3.5 text-[10px] text-muted-foreground/55 font-mono">
                      <span className="truncate">{s.user.username}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span>{s.language}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="tabular-nums">
                        {s.testCasesPassed}/{s.totalTestCases}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>
        </div>
      </ScrollArea>
    </aside>
  )
}

/* ─── Section: collapsible group with a quiet header ─────────────────── */
function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b border-border/60 last:border-b-0"
    >
      <CollapsibleTrigger asChild>
        <button
          className="group flex items-center justify-between w-full px-3 py-2 hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/80">
            <ChevronRight
              className={cn(
                'w-3 h-3 transition-transform text-muted-foreground/50',
                open && 'rotate-90'
              )}
            />
            {title}
          </div>
          {count !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground/50 tabular-nums">
              {count}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-0.5 pb-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
