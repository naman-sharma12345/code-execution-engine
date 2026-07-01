/**
 * SubmissionService — orchestrates the creation of a new submission.
 *
 * Responsibilities:
 *   1. Validate the payload (problem exists, user exists, language supported).
 *   2. Persist a PENDING submission row in Postgres — this is the source of
 *      truth. Even if the queue is lost, the submission is in the DB and can
 *      be re-processed.
 *   3. Enqueue the job into the SubmissionQueue with the user's tier-based
 *      priority (PREMIUM > FREE).
 *   4. Return the submission ID to the caller so they can subscribe to
 *      Socket.io updates.
 */
import { db } from '@/lib/db'
import { getQueue } from '@/queue/SubmissionQueue'
import { TIER_PRIORITY, ALL_LANGUAGES, type Language } from '@/domain/enums'
import type { SubmissionJobPayload } from '@/domain/types'

export interface CreateSubmissionInput {
  problemId: string
  userId: string
  language: Language
  code: string
}

export class SubmissionService {
  async create(input: CreateSubmissionInput) {
    // 1. Validate inputs.
    if (!ALL_LANGUAGES.includes(input.language)) {
      throw new Error(`Unsupported language: ${input.language}`)
    }
    if (!input.code || input.code.trim().length === 0) {
      throw new Error('Code cannot be empty')
    }
    if (input.code.length > 64 * 1024) {
      throw new Error('Source code exceeds 64KB limit')
    }

    const problem = await db.problem.findUnique({
      where: { id: input.problemId },
      select: { id: true, title: true, timeLimit: true, memoryLimit: true },
    })
    if (!problem) throw new Error(`Problem not found: ${input.problemId}`)

    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, subscriptionTier: true, username: true },
    })
    if (!user) throw new Error(`User not found: ${input.userId}`)

    // 2. Persist the submission row.
    const submission = await db.submission.create({
      data: {
        problemId: input.problemId,
        userId: input.userId,
        language: input.language,
        code: input.code,
        status: 'PENDING',
      },
    })

    // 3. Enqueue with priority derived from the user's tier.
    const payload: SubmissionJobPayload = {
      submissionId: submission.id,
      problemId: input.problemId,
      userId: input.userId,
      language: input.language,
      code: input.code,
      tier: user.subscriptionTier as 'FREE' | 'PREMIUM',
      enqueuedAt: Date.now(),
    }
    const priority = TIER_PRIORITY[user.subscriptionTier as 'FREE' | 'PREMIUM'] ?? 1
    getQueue().add(payload, priority)

    return { submissionId: submission.id, priority }
  }

  /** Fetch a single submission with its test-case logs (for the result view). */
  async getById(id: string) {
    return db.submission.findUnique({
      where: { id },
      include: {
        problem: { select: { id: true, title: true, timeLimit: true, memoryLimit: true } },
        user: { select: { id: true, username: true, subscriptionTier: true } },
        executionLogs: {
          include: { testCase: { select: { isHidden: true, order: true } } },
          orderBy: { testCase: { order: 'asc' } },
        },
      },
    })
  }

  /** Paginated list of recent submissions (for the history panel). */
  async listRecent(limit = 20) {
    return db.submission.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        problem: { select: { id: true, title: true } },
        user: { select: { id: true, username: true, subscriptionTier: true } },
      },
    })
  }
}

export const submissionService = new SubmissionService()
