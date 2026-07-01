/**
 * CodeEditor — language selector + code editor + submit/run controls.
 *
 * Uses react-syntax-highlighter for read-only highlighting of the current
 * code in a parallel layer beneath a transparent textarea. This gives us
 * syntax highlighting without losing native text editing behaviors (cursor,
 * selection, copy/paste, IME composition).
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
import { Play, Send, RotateCcw, Loader2 } from 'lucide-react'
import type { Language, SubmissionStatus } from '@/domain/enums'
import { LANGUAGE_LABELS, ALL_LANGUAGES } from '@/domain/enums'

const SYNTAX_LANG: Record<Language, string> = {
  javascript: 'javascript',
  python: 'python',
  cpp: 'cpp',
  java: 'java',
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

  const isBusy = currentStatus === 'PENDING' || currentStatus === 'COMPILING' || currentStatus === 'RUNNING'

  return (
    <div className="flex flex-col h-full bg-card/20">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 bg-card/40">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
            Solution
          </span>
          <Select value={language} onValueChange={(v) => onLanguageChange(v as Language)}>
            <SelectTrigger className="h-7 w-[170px] text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l} className="text-xs font-mono">
                  {LANGUAGE_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] font-mono"
            onClick={onReset}
            disabled={isSubmitting}
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px] font-mono"
            onClick={onSubmit}
            disabled={isSubmitting || isBusy}
          >
            {isSubmitting || isBusy ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {currentStatus ?? 'Queued…'}
              </>
            ) : (
              <>
                <Send className="w-3 h-3 mr-1" />
                Submit (⌘⏎)
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Editor area — textarea overlaid on syntax highlighter */}
      <div className="flex-1 relative overflow-hidden">
        {/* Line numbers gutter */}
        <div className="absolute left-0 top-0 bottom-0 w-10 bg-card/30 border-r border-border flex pt-3 pb-3">
          <div className="flex-1 text-right pr-2 text-[11px] font-mono text-muted-foreground/60 select-none overflow-hidden">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="leading-[1.6]">
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Syntax-highlighted layer */}
        <div className="absolute inset-0 left-10 overflow-auto scrollbar-thin">
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
          className="absolute inset-0 left-10 w-[calc(100%-2.5rem)] h-full bg-transparent text-transparent caret-white resize-none outline-none p-3 code-editor selection:bg-primary/30"
          style={{ caretColor: 'oklch(0.95 0.005 250)' }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border shrink-0 bg-card/40 text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{lineCount} lines</span>
          <span>{code.length} chars</span>
          <span>LF · UTF-8</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Tab = 2 spaces</span>
          <span className="text-muted-foreground/50">·</span>
          <span>⌘⏎ to submit</span>
        </div>
      </div>
    </div>
  )
}

export { STARTER_CODE }
