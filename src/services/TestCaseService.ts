/**
 * TestCaseService — fetches problems and their test cases.
 *
 * For the public API we NEVER expose hidden test case inputs/expected outputs.
 * The list endpoint returns metadata only (count, hidden count) so the UI can
 * show "5 test cases (3 hidden)". The actual hidden data is only ever read
 * by the worker, internally.
 */
import { db } from '@/lib/db'

export class TestCaseService {
  /** Public-safe problem view — hides hidden test cases entirely. */
  async listProblems() {
    const problems = await db.problem.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { testCases: true, submissions: true } },
      },
    })
    return problems.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      timeLimit: p.timeLimit,
      memoryLimit: p.memoryLimit,
      difficulty: p.difficulty,
      tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
      totalTestCases: p._count.testCases,
      totalSubmissions: p._count.submissions,
    }))
  }

  /** Public-safe single problem — includes sample test cases only. */
  async getProblem(id: string) {
    const problem = await db.problem.findUnique({
      where: { id },
      include: {
        testCases: {
          where: { isHidden: false },
          orderBy: { order: 'asc' },
        },
        _count: { select: { testCases: true } },
      },
    })
    if (!problem) return null
    return {
      id: problem.id,
      title: problem.title,
      description: problem.description,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      difficulty: problem.difficulty,
      tags: problem.tags ? problem.tags.split(',').filter(Boolean) : [],
      sampleTestCases: problem.testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        order: tc.order,
      })),
      totalTestCases: problem._count.testCases,
      hiddenTestCases: problem._count.testCases - problem.testCases.length,
    }
  }

  /** Internal: fetch ALL test cases (including hidden) for the worker. */
  async getAllTestCases(problemId: string) {
    return db.testCase.findMany({
      where: { problemId },
      orderBy: { order: 'asc' },
    })
  }
}

export const testCaseService = new TestCaseService()
