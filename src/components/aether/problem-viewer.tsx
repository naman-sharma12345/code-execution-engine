/**
 * ProblemViewer — renders the problem statement with a tabbed interface.
 *
 * Design intent:
 *   The previous version crammed description + sample test cases + a tip
 *   box into a single scroll area, which felt cramped. This redesign
 *   splits them across three tabs — Description, Samples, and Notes —
 *   so each section gets the full center area.
 *
 *   - Header row: title + inline metadata (limits, difficulty, test count)
 *     as small mono text, NOT a cluster of pills.
 *   - Tabs are flat (no pill background) — active tab gets a 2px violet
 *     underline; inactive tabs are muted.
 *   - Description: prose-aether markdown, capped line-length for reading.
 *   - Samples: terminal-style cards with Input / Expected side by side
 *     behind a quiet header bar.
 *   - Notes: I/O hints (stdin/stdout), integrated as a small reference
 *     card rather than a noisy "Tip:" callout.
 */
'use client'

import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { FileText, Terminal, BookOpen, Clock, MemoryStick, Lock } from 'lucide-react'
import type { ProblemDetail } from '@/lib/api'

const DIFFICULTY_LABEL: Record<string, { label: string; color: string }> = {
  EASY: { label: 'Easy', color: 'text-emerald-400' },
  MEDIUM: { label: 'Medium', color: 'text-amber-400' },
  HARD: { label: 'Hard', color: 'text-rose-400' },
}

export function ProblemViewer({ problem }: { problem: ProblemDetail | null }) {
  if (!problem) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-xs">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-secondary/60 border border-border/60 mb-3">
            <FileText className="w-4 h-4 text-muted-foreground/70" />
          </div>
          <p className="text-sm font-medium text-foreground/90">No problem selected</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Pick a problem from the sidebar to see its statement, sample cases,
            and constraints.
          </p>
        </div>
      </div>
    )
  }

  const diff = DIFFICULTY_LABEL[problem.difficulty] ?? {
    label: problem.difficulty,
    color: 'text-muted-foreground',
  }
  const sampleCount = problem.sampleTestCases.length

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ─── Problem header ─────────────────────────────────────────── */}
      <div className="border-b border-border px-5 pt-4 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground leading-tight">
              {problem.title}
            </h2>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] font-mono text-muted-foreground/75">
              <span className={cn('font-medium', diff.color)}>{diff.label}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="tabular-nums">{problem.timeLimit}ms</span>
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1">
                <MemoryStick className="w-3 h-3" />
                <span className="tabular-nums">{problem.memoryLimit}MB</span>
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span className="tabular-nums">{problem.totalTestCases}</span> tests
              </span>
              {problem.hiddenTestCases > 0 && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span className="tabular-nums">{problem.hiddenTestCases}</span> hidden
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────── */}
      <Tabs
        defaultValue="description"
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-5 border-b border-border shrink-0">
          <TabsList className="bg-transparent h-9 p-0 gap-5 rounded-none">
            <TabsTrigger
              value="description"
              className="bg-transparent shadow-none px-0 py-2 rounded-none text-[12px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary rounded-none gap-1.5 hover:text-foreground"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Description
            </TabsTrigger>
            <TabsTrigger
              value="samples"
              className="bg-transparent shadow-none px-0 py-2 rounded-none text-[12px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary rounded-none gap-1.5 hover:text-foreground"
            >
              <Terminal className="w-3.5 h-3.5" />
              Samples
              {sampleCount > 0 && (
                <span className="ml-1 text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                  {sampleCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              className="bg-transparent shadow-none px-0 py-2 rounded-none text-[12px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary rounded-none gap-1.5 hover:text-foreground"
            >
              I/O Notes
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ─── Description tab ───────────────────────────────────── */}
        <TabsContent
          value="description"
          className="flex-1 min-h-0 data-[state=inactive]:hidden outline-none"
        >
          <ScrollArea className="h-full scrollbar-thin">
            <div className="px-5 py-5">
              <div className="prose-aether max-w-[68ch]">
                <ReactMarkdown>{problem.description}</ReactMarkdown>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ─── Samples tab ──────────────────────────────────────── */}
        <TabsContent
          value="samples"
          className="flex-1 min-h-0 data-[state=inactive]:hidden outline-none"
        >
          <ScrollArea className="h-full scrollbar-thin">
            <div className="px-5 py-5 space-y-3 max-w-[88ch]">
              {sampleCount === 0 ? (
                <div className="text-center py-12 text-muted-foreground/70">
                  <Terminal className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No sample test cases for this problem.</p>
                </div>
              ) : (
                problem.sampleTestCases.map((tc, i) => (
                  <SampleCard
                    key={tc.id}
                    index={i + 1}
                    input={tc.input}
                    expectedOutput={tc.expectedOutput}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ─── I/O Notes tab ────────────────────────────────────── */}
        <TabsContent
          value="notes"
          className="flex-1 min-h-0 data-[state=inactive]:hidden outline-none"
        >
          <ScrollArea className="h-full scrollbar-thin">
            <div className="px-5 py-5 max-w-[68ch] space-y-4">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground mb-2">
                  Input / Output
                </h3>
                <p className="text-[13px] text-muted-foreground/85 leading-relaxed mb-3">
                  Your solution reads input from{' '}
                  <code className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-secondary/70 border border-border/60 text-foreground/90">stdin</code>{' '}
                  (file descriptor 0) and writes output to{' '}
                  <code className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-secondary/70 border border-border/60 text-foreground/90">stdout</code>.
                  The harness compares your stdout against the expected output
                  verbatim — trailing whitespace matters.
                </p>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/30 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/60 bg-secondary/40">
                  <div className="flex items-center gap-2 text-[11px] font-mono font-medium text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-rose-500/70" />
                    <span className="w-2 h-2 rounded-full bg-amber-500/70" />
                    <span className="w-2 h-2 rounded-full bg-emerald-500/70" />
                    <span className="ml-2">runner.sh</span>
                  </div>
                </div>
                <pre className="px-3.5 py-3 text-[12px] font-mono leading-relaxed text-foreground/85 overflow-x-auto">
{`# pseudocode of the harness
input  = read(fd=0)            # all of stdin
stdout = run(solution, input)  # bounded by time + memory
expected = test_case.expected_output
assert stdout.strip() == expected.strip()`}
                </pre>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NoteCard title="Constraints">
                  <ul className="space-y-1 text-[12px] text-muted-foreground/80">
                    <li>· Wall-clock time limit: <span className="font-mono text-foreground/90 tabular-nums">{problem.timeLimit}ms</span></li>
                    <li>· Memory limit: <span className="font-mono text-foreground/90 tabular-nums">{problem.memoryLimit}MB</span></li>
                    <li>· Network access is disabled in the sandbox.</li>
                    <li>· File writes outside <code className="font-mono text-foreground/90">/tmp</code> are blocked.</li>
                  </ul>
                </NoteCard>
                <NoteCard title="What gets graded">
                  <ul className="space-y-1 text-[12px] text-muted-foreground/80">
                    <li>· <span className="font-mono text-foreground/90">{problem.totalTestCases}</span> test cases total.</li>
                    <li>· <span className="font-mono text-foreground/90">{sampleCount}</span> are visible samples.</li>
                    <li>· <span className="font-mono text-foreground/90">{problem.hiddenTestCases}</span> are hidden, used for grading.</li>
                    <li>· Verdict is the worst case across all tests.</li>
                  </ul>
                </NoteCard>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ─── SampleCard: terminal-style Input / Expected Output card ──────── */
function SampleCard({
  index,
  input,
  expectedOutput,
}: {
  index: number
  input: string
  expectedOutput: string
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 overflow-hidden">
      {/* Card header bar — looks like an IDE panel */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-secondary/40">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span className="text-muted-foreground/70">sample</span>
          <span className="text-foreground/90 font-medium tabular-nums">#{index}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500/60" />
          <span className="text-[10px] font-mono text-muted-foreground/60">static</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/60">
        <SamplePane label="Input" tone="input" content={input} />
        <SamplePane label="Expected Output" tone="output" content={expectedOutput} />
      </div>
    </div>
  )
}

function SamplePane({
  label,
  tone,
  content,
}: {
  label: string
  tone: 'input' | 'output'
  content: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-background/30">
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            tone === 'input' ? 'bg-cyan-400/70' : 'bg-emerald-400/70'
          )}
        />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
      </div>
      <pre className="px-3 py-2.5 text-[12px] font-mono leading-relaxed text-foreground/90 whitespace-pre-wrap break-words min-h-[3rem] terminal-text">
        {content || <span className="text-muted-foreground/40 italic">(empty)</span>}
      </pre>
    </div>
  )
}

/* ─── NoteCard: small reference card used in the I/O Notes tab ──────── */
function NoteCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-3.5">
      <div className="text-[11px] font-mono font-medium uppercase tracking-wider text-muted-foreground/80 mb-2">
        {title}
      </div>
      {children}
    </div>
  )
}
