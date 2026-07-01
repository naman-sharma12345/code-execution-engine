/**
 * GET /api/submissions/:id — fetch a single submission's full state.
 *
 * Returns the submission + per-test-case execution logs. Hidden test cases
 * are still redacted (we only return the test case's `isHidden` flag + order,
 * not its input/expected output).
 */
import { NextRequest, NextResponse } from 'next/server'
import { submissionService } from '@/services/SubmissionService'
import { ensureEngineStarted } from '@/services/EngineBootstrap'

ensureEngineStarted()

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const submission = await submissionService.getById(id)
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    return NextResponse.json({ submission })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
