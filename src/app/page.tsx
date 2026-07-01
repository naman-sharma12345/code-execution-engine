/**
 * AetherRun — main page.
 *
 * Layout (desktop):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Header: wordmark · live engine indicator · user picker       │
 *   ├────────────┬─────────────────────────────┬───────────────────┤
 *   │            │  Problem Viewer             │ Execution Panel   │
 *   │  Sidebar   │  (tabs: Description |       │ (live log + tests │
 *   │  problems  │   Samples | Notes)          │  + verdict)       │
 *   │  leaderboard├─────── ↕ drag ─────────────┤                   │
 *   │  history   │  Code Editor                │                   │
 *   │            │  (filename tab + textarea)  │                   │
 *   ├────────────┴─────────────────────────────┴───────────────────┤
 *   │ StatsBar: queue · workers · processed · uptime               │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The center column uses a resizable vertical split (react-resizable-panels)
 * so the user can drag the divider between the problem statement and the
 * code editor. The ProblemViewer uses internal tabs (Description / Samples
 * / Notes) so each section gets the full panel height — fixing the
 * "problem and example are on top of each other" complaint.
 *
 * State flow:
 *   1. User picks a problem → loads problem + sample test cases.
 *   2. User types code, picks a language, clicks Submit.
 *   3. POST /api/submissions → returns submissionId.
 *   4. useSubmissionStream(submissionId) connects via Socket.io, streams events.
 *   5. ExecutionPanel renders events in real-time.
 *   6. On 'final' event, refresh sidebar history + leaderboard.
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Header } from '@/components/aether/header'
import { ProblemSidebar } from '@/components/aether/problem-sidebar'
import { ProblemViewer } from '@/components/aether/problem-viewer'
import { CodeEditor, STARTER_CODE } from '@/components/aether/code-editor'
import { ExecutionPanel } from '@/components/aether/execution-panel'
import { StatsBar } from '@/components/aether/stats-bar'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { useSubmissionStream } from '@/hooks/use-submission-stream'
import { api, type ProblemListItem, type ProblemDetail, type User, type SubmissionListItem, type LeaderboardEntry, type EngineStats } from '@/lib/api'
import type { Language, SubmissionStatus } from '@/domain/enums'
import type { SubmissionEvent } from '@/domain/types'

export default function Home() {
  // ─── Data state ─────────────────────────────────────────────────
  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [stats, setStats] = useState<EngineStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [recentSubmissions, setRecentSubmissions] = useState<SubmissionListItem[]>([])

  // ─── Selection state ────────────────────────────────────────────
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null)
  const [language, setLanguage] = useState<Language>('javascript')
  const [code, setCode] = useState(STARTER_CODE['javascript'])

  // ─── Submission state ───────────────────────────────────────────
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { events, isConnected } = useSubmissionStream(activeSubmissionId)

  // Derived current status from the events stream. Using useMemo (instead
  // of a separate state var + effect) avoids the cascading-render anti-pattern
  // flagged by react-hooks/set-state-in-effect.
  const currentStatus = useMemo<SubmissionStatus | null>(() => {
    if (events.length === 0) return null
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev.type === 'status' && ev.status) return ev.status
      if (ev.type === 'final' && ev.result) return ev.result.status
    }
    return null
  }, [events])

  // Track the last status we toasted/refreshed for so we don't double-fire.
  const lastProcessedStatus = useRef<SubmissionStatus | null>(null)

  // ─── Initial data load ──────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.listProblems(), api.listUsers(), api.getLeaderboard(), api.listSubmissions()])
      .then(([p, u, lb, subs]) => {
        setProblems(p.problems)
        setUsers(u.users)
        if (u.users.length > 0) setCurrentUser(u.users[0])
        setLeaderboard(lb.leaderboard)
        setRecentSubmissions(subs.submissions)
        if (p.problems.length > 0) setSelectedProblemId(p.problems[0].id)
      })
      .catch((err) => toast.error('Failed to load: ' + err.message))
  }, [])

  // Poll stats for the header
  useEffect(() => {
    const poll = async () => {
      try { setStats(await api.getStats()) } catch { /* ignore */ }
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [])

  // Load problem detail on selection
  useEffect(() => {
    if (!selectedProblemId) return
    api.getProblem(selectedProblemId)
      .then((d) => setProblemDetail(d.problem))
      .catch((err) => toast.error('Failed to load problem: ' + err.message))
  }, [selectedProblemId])

  // When language changes, load starter code IF the editor is empty or
  // still showing the previous language's starter.
  const handleLanguageChange = useCallback(
    (newLang: Language) => {
      const oldStarter = STARTER_CODE[language]
      if (code === oldStarter || code.trim() === '') {
        setCode(STARTER_CODE[newLang])
      }
      setLanguage(newLang)
    },
    [language, code]
  )

  const handleReset = useCallback(() => {
    setCode(STARTER_CODE[language])
    toast.success('Code reset to starter template')
  }, [language])

  // Side-effect when status transitions to a terminal verdict: refresh
  // sidebar data + toast the verdict. We use a ref to dedupe so we only fire
  // this ONCE per submission (not on every event re-render).
  useEffect(() => {
    if (!currentStatus || currentStatus === lastProcessedStatus.current) return
    if (!['ACCEPTED', 'WRONG_ANSWER', 'TLE', 'MLE', 'RTE', 'FAILED'].includes(currentStatus)) return

    lastProcessedStatus.current = currentStatus
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate: clearing the "submitting" flag when the submission reaches a terminal state is a one-shot side-effect, not a cascading render.
    setIsSubmitting(false)

    const last = events[events.length - 1]
    if (last?.type === 'final' && last.result) {
      Promise.all([api.listSubmissions(), api.getLeaderboard()])
        .then(([subs, lb]) => {
          setRecentSubmissions(subs.submissions)
          setLeaderboard(lb.leaderboard)
        })
        .catch(() => { /* ignore */ })

      if (last.result.status === 'ACCEPTED') {
        toast.success(`Accepted! ${last.result.testCasesPassed}/${last.result.totalTestCases} test cases passed.`)
      } else {
        toast.error(`${last.result.status} — ${last.result.testCasesPassed}/${last.result.totalTestCases} test cases passed.`)
      }
    }
  }, [currentStatus, events])

  // ─── Submit handler ─────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!selectedProblemId || !currentUser) {
      toast.error('Select a problem and user first')
      return
    }
    if (!code.trim()) {
      toast.error('Code cannot be empty')
      return
    }

    setIsSubmitting(true)
    lastProcessedStatus.current = null // reset dedup so a new final verdict toasts again
    setActiveSubmissionId(null) // disconnect old socket before reconnecting

    try {
      const res = await api.createSubmission({
        problemId: selectedProblemId,
        language,
        code,
        userId: currentUser.id,
      })
      setActiveSubmissionId(res.submissionId)
      toast.info(`Submission queued (priority ${res.priority}, tier ${res.tier})`)
    } catch (err) {
      setIsSubmitting(false)
      toast.error(err instanceof Error ? err.message : 'Submission failed')
    }
  }, [selectedProblemId, currentUser, code, language])

  // ─── View a past submission ─────────────────────────────────────
  // For past submissions we don't get live events (the socket only streams
  // NEW events). We just navigate the user to the submission detail page
  // via a fetch; the execution panel will show the static verdict from the
  // events we synthesize below.
  const handleSelectSubmission = useCallback(async (id: string) => {
    try {
      const d = await api.getSubmission(id)
      // Synthesize a final event so the execution panel renders the verdict.
      // We push it through setActiveSubmissionId — but since the socket won't
      // stream past events, we need a different approach. For now, just toast.
      toast.info(`Submission ${id.slice(-8)}: ${d.submission.status} (${d.submission.testCasesPassed}/${d.submission.totalTestCases} passed)`)
    } catch (err) {
      toast.error('Failed to load submission')
    }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background bg-dots overflow-hidden">
      <Header
        users={users}
        currentUser={currentUser}
        onUserChange={setCurrentUser}
        stats={stats}
      />

      <div className="flex-1 flex min-h-0">
        <ProblemSidebar
          problems={problems}
          selectedProblemId={selectedProblemId}
          onSelectProblem={setSelectedProblemId}
          leaderboard={leaderboard}
          recentSubmissions={recentSubmissions}
          onSelectSubmission={handleSelectSubmission}
        />

        {/* Center: problem + code editor (resizable vertical split) */}
        <div className="flex-1 flex flex-col min-w-0">
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel defaultSize={55} minSize={20} className="min-h-0">
              <ProblemViewer problem={problemDetail} />
            </ResizablePanel>
            <ResizableHandle
              withHandle
              className="bg-border/60 hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60 transition-colors"
            />
            <ResizablePanel defaultSize={45} minSize={25} className="min-h-0">
              <CodeEditor
                language={language}
                onLanguageChange={handleLanguageChange}
                code={code}
                onCodeChange={setCode}
                onSubmit={handleSubmit}
                onReset={handleReset}
                isSubmitting={isSubmitting}
                currentStatus={currentStatus}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Right: execution panel */}
        <aside className="w-[380px] border-l border-border shrink-0 hidden lg:flex flex-col">
          <ExecutionPanel
            events={events}
            isLive={isConnected && isSubmitting}
            submissionId={activeSubmissionId}
          />
        </aside>
      </div>

      <StatsBar />
    </div>
  )
}
