/**
 * ProblemSidebar — left rail with problems list, leaderboard, submission history.
 */
'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { VerdictBadge } from './verdict-badge'
import type { ProblemListItem, SubmissionListItem, LeaderboardEntry } from '@/lib/api'
import { Trophy, ListChecks, History, Flame } from 'lucide-react'

const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: 'text-emerald-400',
  MEDIUM: 'text-amber-400',
  HARD: 'text-rose-400',
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
    <aside className="w-72 border-r border-border bg-card/30 flex flex-col shrink-0">
      {/* Problems list */}
      <Section icon={<ListChecks className="w-3.5 h-3.5" />} title="Problems" count={problems.length}>
        <div className="space-y-0.5">
          {problems.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProblem(p.id)}
              className={cn(
                'w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors group',
                'hover:bg-accent/50',
                selectedProblemId === p.id
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'border-l-2 border-transparent'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{p.title}</span>
                <span className={cn('text-[10px] font-mono shrink-0', DIFFICULTY_COLORS[p.difficulty])}>
                  {p.difficulty}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground font-mono">
                <span>{p.totalTestCases} tests</span>
                <span>·</span>
                <span>{p.timeLimit}ms</span>
                <span>·</span>
                <span>{p.memoryLimit}MB</span>
              </div>
            </button>
          ))}
        </div>
      </Section>

      {/* Leaderboard */}
      <Section icon={<Trophy className="w-3.5 h-3.5" />} title="Leaderboard" count={leaderboard.length}>
        <div className="space-y-1">
          {leaderboard.slice(0, 5).map((u, i) => (
            <div
              key={u.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50"
            >
              <span
                className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono shrink-0',
                  i === 0
                    ? 'bg-amber-500/20 text-amber-400'
                    : i === 1
                    ? 'bg-slate-400/20 text-slate-300'
                    : i === 2
                    ? 'bg-orange-700/20 text-orange-400'
                    : 'bg-muted/30 text-muted-foreground'
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{u.username}</span>
                  {u.tier === 'PREMIUM' && (
                    <Flame className="w-2.5 h-2.5 text-amber-400 shrink-0" fill="currentColor" />
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {u.accepted}/{u.total} · {u.acceptanceRate}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Recent submissions */}
      <Section
        icon={<History className="w-3.5 h-3.5" />}
        title="Recent Submissions"
        count={recentSubmissions.length}
        fillRemaining
      >
        <ScrollArea className="h-full scrollbar-thin">
          <div className="space-y-1 pr-2">
            {recentSubmissions.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic px-2 py-3 text-center">
                No submissions yet
              </p>
            )}
            {recentSubmissions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectSubmission(s.id)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium truncate">{s.problem.title}</span>
                  <VerdictBadge status={s.status} size="sm" />
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground font-mono">
                  <span>{s.user.username}</span>
                  <span>·</span>
                  <span>{s.language}</span>
                  <span>·</span>
                  <span>{s.executionTime}ms</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Section>
    </aside>
  )
}

function Section({
  icon,
  title,
  count,
  children,
  fillRemaining = false,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  children: React.ReactNode
  fillRemaining?: boolean
}) {
  return (
    <div className={cn('border-b border-border last:border-b-0', fillRemaining ? 'flex-1 min-h-0 flex flex-col' : '')}>
      <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-card/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </div>
        {count !== undefined && (
          <Badge variant="secondary" className="h-4 text-[10px] px-1.5 font-mono">
            {count}
          </Badge>
        )}
      </div>
      <div className={cn('px-1.5 pb-2', fillRemaining ? 'flex-1 min-h-0' : '')}>{children}</div>
    </div>
  )
}
