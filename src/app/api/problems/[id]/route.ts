/**
 * GET /api/problems/:id — single problem with sample test cases (public-safe).
 */
import { NextRequest, NextResponse } from 'next/server'
import { testCaseService } from '@/services/TestCaseService'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const problem = await testCaseService.getProblem(id)
    if (!problem) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 })
    }
    return NextResponse.json({ problem })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
