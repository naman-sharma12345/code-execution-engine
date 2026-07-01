/**
 * ProblemViewer — renders the problem description (markdown) and sample test cases.
 */
'use client'

import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Clock, MemoryStick, FileText, Eye, EyeOff } from 'lucide-react'
import type { ProblemDetail } from '@/lib/api'

export function ProblemViewer({ problem }: { problem: ProblemDetail | null }) {
  if (!problem) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a problem to begin
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Problem header */}
      <div className="border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <h2 className="text-base font-semibold tracking-tight">{problem.title}</h2>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${
              problem.difficulty === 'EASY'
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
                : problem.difficulty === 'MEDIUM'
                ? 'border-amber-500/30 text-amber-400 bg-amber-500/5'
                : 'border-rose-500/30 text-rose-400 bg-rose-500/5'
            }`}
          >
            {problem.difficulty}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {problem.timeLimit}ms
          </span>
          <span className="flex items-center gap-1">
            <MemoryStick className="w-3 h-3" />
            {problem.memoryLimit}MB
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {problem.totalTestCases} tests
          </span>
          <span className="flex items-center gap-1">
            <EyeOff className="w-3 h-3" />
            {problem.hiddenTestCases} hidden
          </span>
        </div>
      </div>

      {/* Problem description + sample test cases */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="px-4 py-3">
          <div className="prose-aether max-w-none">
            <ReactMarkdown>{problem.description}</ReactMarkdown>
          </div>

          {problem.sampleTestCases.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                <Eye className="w-3 h-3" />
                Sample Test Cases
              </div>
              <div className="space-y-2">
                {problem.sampleTestCases.map((tc) => (
                  <div
                    key={tc.id}
                    className="border border-border rounded-md overflow-hidden bg-card/40"
                  >
                    <div className="grid grid-cols-2 divide-x divide-border">
                      <div className="p-2.5">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
                          Input
                        </div>
                        <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">
                          {tc.input}
                        </pre>
                      </div>
                      <div className="p-2.5">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
                          Expected Output
                        </div>
                        <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">
                          {tc.expectedOutput}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Language hints */}
          <div className="mt-4 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/20 text-[11px] text-blue-300/80 font-mono">
            <strong className="text-blue-300">Tip:</strong> Read input from{' '}
            <code className="bg-blue-500/10 px-1 py-0.5 rounded">stdin</code> (fd 0). Print output to{' '}
            <code className="bg-blue-500/10 px-1 py-0.5 rounded">stdout</code>. Wrap your code in a
            function or write top-level statements.
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
