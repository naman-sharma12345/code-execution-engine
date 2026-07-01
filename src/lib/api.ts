/**
 * Frontend API client — thin wrappers over fetch() for the engine's REST API.
 *
 * All functions return typed data; throw on non-2xx responses.
 */

export interface ProblemListItem {
  id: string
  title: string
  description: string
  timeLimit: number
  memoryLimit: number
  difficulty: string
  tags: string[]
  totalTestCases: number
  totalSubmissions: number
}

export interface ProblemDetail extends ProblemListItem {
  sampleTestCases: { id: string; input: string; expectedOutput: string; order: number }[]
  hiddenTestCases: number
}

export interface SubmissionListItem {
  id: string
  problemId: string
  userId: string
  language: string
  status: string
  executionTime: number
  memoryUsed: number
  testCasesPassed: number
  totalTestCases: number
  createdAt: string
  completedAt: string | null
  problem: { id: string; title: string }
  user: { id: string; username: string; subscriptionTier: string }
}

export interface ExecutionLog {
  id: string
  submissionId: string
  testCaseId: string
  status: string
  stdout: string
  stderr: string
  exitCode: number
  executionTime: number
  memoryUsed: number
  testCase: { isHidden: boolean; order: number }
}

export interface SubmissionDetail extends SubmissionListItem {
  code: string
  errorMessage: string | null
  compileOutput: string | null
  executionLogs: ExecutionLog[]
  problem: { id: string; title: string; timeLimit: number; memoryLimit: number }
}

export interface EngineStats {
  queue: { waiting: number; active: number; delayed: number; failed: number; completed: number }
  workers: { count: number; busy: number; idle: number }
  containerPool: { total: number; idle: number; inUse: number; warmsPerLanguage: Record<string, number> }
  throughput: {
    processed: number
    accepted: number
    rejected: number
    avgLatencyMs: number
    totalSubmissions: number
    lastHourAccepted: number
    lastHourRejected: number
  }
  uptimeMs: number
}

export interface LeaderboardEntry {
  id: string
  username: string
  tier: string
  accepted: number
  total: number
  acceptanceRate: number
}

export interface User {
  id: string
  username: string
  email: string
  subscriptionTier: string
  createdAt: string
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  async listProblems(): Promise<{ problems: ProblemListItem[] }> {
    return jsonOrThrow(await fetch('/api/problems'))
  },

  async getProblem(id: string): Promise<{ problem: ProblemDetail }> {
    return jsonOrThrow(await fetch(`/api/problems/${id}`))
  },

  async listUsers(): Promise<{ users: User[] }> {
    return jsonOrThrow(await fetch('/api/users'))
  },

  async login(username: string): Promise<{ token: string; user: { id: string; username: string; tier: string } }> {
    return jsonOrThrow(await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }))
  },

  async createSubmission(input: {
    problemId: string
    language: string
    code: string
    userId?: string
  }): Promise<{ submissionId: string; priority: number; tier: string }> {
    const url = new URL('/api/submissions', window.location.origin)
    if (input.userId) url.searchParams.set('userId', input.userId)
    return jsonOrThrow(await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problemId: input.problemId,
        language: input.language,
        code: input.code,
      }),
    }))
  },

  async listSubmissions(limit = 20): Promise<{ submissions: SubmissionListItem[] }> {
    return jsonOrThrow(await fetch(`/api/submissions?limit=${limit}`))
  },

  async getSubmission(id: string): Promise<{ submission: SubmissionDetail }> {
    return jsonOrThrow(await fetch(`/api/submissions/${id}`))
  },

  async getStats(): Promise<EngineStats> {
    return jsonOrThrow(await fetch('/api/stats'))
  },

  async getLeaderboard(): Promise<{ leaderboard: LeaderboardEntry[] }> {
    return jsonOrThrow(await fetch('/api/leaderboard'))
  },
}
