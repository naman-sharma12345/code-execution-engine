/**
 * CodeEditor — language selector + code editor + submit controls.
 *
 * Design:
 *   - Editor chrome: a filename tab strip (like VS Code) with the active
 *     file name, plus a small dot indicator for the language family.
 *   - Toolbar is minimal: language selector on the left, reset + submit
 *     on the right. Reset is a small icon button; Submit is prominent.
 *   - Submit button has a clear loading state with the live status text.
 *   - Tab key inserts 2 spaces. Cmd/Ctrl+Enter submits.
 *
 * Implementation:
 *   react-syntax-highlighter renders a read-only highlighted layer; a
 *   transparent textarea sits on top to capture input. This preserves
 *   native text-editing behavior (cursor, selection, IME, paste).
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RotateCcw, Loader2, Play } from 'lucide-react'
import type { Language, SubmissionStatus } from '@/domain/enums'
import { LANGUAGE_LABELS, ALL_LANGUAGES, LANGUAGE_FILE_EXTENSIONS } from '@/domain/enums'
import { cn } from '@/lib/utils'

const SYNTAX_LANG: Record<Language, string> = {
  javascript: 'javascript',
  python: 'python',
  cpp: 'cpp',
  java: 'java',
}

const LANGUAGE_ACCENT: Record<Language, string> = {
  javascript: 'bg-amber-400',
  python: 'bg-sky-400',
  cpp: 'bg-blue-400',
  java: 'bg-rose-400',
}

// Default starter code per language — uses fd 0 for stdin (most portable)
const STARTER_CODE: Record<Language, string> = {
  javascript: `// JavaScript (Node.js) — read from fd 0, print to console
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8').trim().split(/\\s+/);
const [a, b] = input.map(Number);
console.log(a + b);
`,
  python: `# Python 3 — read from stdin, print to stdout
import sys
data = sys.stdin.read().split()
a, b = int(data[0]), int(data[1])
print(a + b)
`,
  cpp: `// C++17 — read from cin, print to cout
#include <bits/stdc++.h>
using namespace std;

int main() {
    long long a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`,
  java: `// Java 21 — class name MUST be "Main"
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong();
        long b = sc.nextLong();
        System.out.println(a + b);
    }
}
`,
}

export function CodeEditor({
  language,
  onLanguageChange,
  code,
  onCodeChange,
  onSubmit,
  onReset,
  isSubmitting,
  currentStatus,
}: {
  language: Language
  onLanguageChange: (l: Language) => void
  code: string
  onCodeChange: (c: string) => void
  onSubmit: () => void
  onReset: () => void
  isSubmitting: boolean
  currentStatus: SubmissionStatus | null
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [lineCount, setLineCount] = useState(0)

  useEffect(() => {
    setLineCount(code.split('\n').length)
  }, [code])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab inserts 2 spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newCode = code.substring(0, start) + '  ' + code.substring(end)
      onCodeChange(newCode)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
    // Cmd/Ctrl + Enter submits
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!isSubmitting) onSubmit()
    }
  }

  const isBusy =
    currentStatus === 'PENDING' ||
    currentStatus === 'COMPILING' ||
    currentStatus === 'RUNNING'

  const fileName = `solution.${LANGUAGE_FILE_EXTENSIONS[language]}`

  return (
    <div className="flex flex-col h-full bg-card/30">
      {/* ─── Editor chrome: filename tab strip ───────────────────── */}
      <div className="flex items-center justify-between pl-2 pr-2 border-b border-border shrink-0 bg-sidebar/40 h-9">
        {/* Filename tab — looks like a VS Code editor tab */}
        <div className="flex items-center h-full">
          <div className="flex items-center gap-2 h-full px-3 border-r border-border bg-card/70 -mb-px border-b-2 border-b-primary/70 relative">
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full',
                LANGUAGE_ACCENT[language]
              )}
            />
            <span className="text-[12px] font-mono text-foreground/90">
              {fileName}
            </span>
            {/* Modified indicator — shown when code differs from starter */}
            {code !== STARTER_CODE[language] && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/80 ml-0.5" />
            )}
          </div>
          {/* Spacer tab (empty) — gives the editor-chrome feel */}
          <div className="h-full px-3 flex items-center text-[11px] font-mono text-muted-foreground/40">
            <span>untitled</span>
          </div>
        </div>

        {/* Right side: language + actions */}
        <div className="flex items-center gap-1.5">
          <Select value={language} onValueChange={(v) => onLanguageChange(v as Language)}>
            <SelectTrigger className="h-7 w-[150px] text-[11px] font-mono bg-secondary/40 hover:bg-secondary/70 border-border/60 transition-colors gap-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l} className="text-[11px] font-mono gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full',
                        LANGUAGE_ACCENT[l]
                      )}
                    />
                    {LANGUAGE_LABELS[l]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onReset}
                disabled={isSubmitting}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset to starter code</TooltipContent>
          </Tooltip>

          <Button
            size="sm"
            className={cn(
              'h-7 px-3 text-[12px] font-medium gap-1.5 transition-all',
              'bg-primary hover:bg-primary/90 text-primary-foreground',
              'disabled:opacity-60',
              (isSubmitting || isBusy) && 'bg-primary/80'
            )}
            onClick={onSubmit}
            disabled={isSubmitting || isBusy}
          >
            {isSubmitting || isBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="font-mono text-[11px] uppercase tracking-wider">
                  {currentStatus ?? 'Queued'}
                </span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" fill="currentColor" />
                Submit
                <span className="hidden sm:inline text-[10px] font-mono opacity-70 ml-0.5">
                  ⌘⏎
                </span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ─── Editor area — textarea overlaid on syntax highlighter ── */}
      <div className="flex-1 relative overflow-hidden bg-background">
        {/* Line numbers gutter */}
        <div className="absolute left-0 top-0 bottom-0 w-11 bg-sidebar/30 border-r border-border/60 flex pt-3 pb-3 select-none">
          <div className="flex-1 text-right pr-2.5 text-[11px] font-mono text-muted-foreground/40 overflow-hidden terminal-text">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="leading-[1.6] tabular-nums">
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Syntax-highlighted layer */}
        <div className="absolute inset-0 left-11 overflow-auto scrollbar-thin">
          <div className="p-3 min-h-full">
            <SyntaxHighlighter
              language={SYNTAX_LANG[language]}
              style={oneDark}
              customStyle={{
                background: 'transparent',
                padding: 0,
                margin: 0,
                fontSize: '13px',
                fontFamily: 'var(--font-geist-mono), monospace',
                lineHeight: '1.6',
                minHeight: '100%',
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: '13px',
                },
              }}
              showLineNumbers={false}
            >
              {code + '\n'}
            </SyntaxHighlighter>
          </div>
        </div>

        {/* Transparent textarea on top — receives all keyboard input */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="absolute inset-0 left-11 w-[calc(100%-2.75rem)] h-full bg-transparent text-transparent caret-white resize-none outline-none p-3 code-editor selection:bg-primary/30"
          style={{ caretColor: 'oklch(0.96 0.004 60)' }}
        />
      </div>

      {/* ─── Status bar — bottom strip with file info ─────────────── */}
      <div className="flex items-center justify-between px-3 h-6 border-t border-border shrink-0 bg-sidebar/40 text-[10px] font-mono text-muted-foreground/70 terminal-text">
        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            Ln {lineCount}, Col 1
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="tabular-nums">{code.length} chars</span>
          <span className="text-muted-foreground/30">·</span>
          <span>UTF-8</span>
          <span className="text-muted-foreground/30">·</span>
          <span>LF</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Spaces: 2</span>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-primary/80">⌘⏎ to submit</span>
        </div>
      </div>
    </div>
  )
}

export { STARTER_CODE }
