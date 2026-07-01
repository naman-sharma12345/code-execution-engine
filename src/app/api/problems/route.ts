/**
 * GET /api/problems — list all problems (public-safe: no hidden test cases).
 * GET /api/problems/:id — single problem with sample test cases.
 */
import { NextRequest, NextResponse } from 'next/server'
import { testCaseService } from '@/services/TestCaseService'

export async function GET() {
  try {
    const problems = await testCaseService.listProblems()
    return NextResponse.json({ problems })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
