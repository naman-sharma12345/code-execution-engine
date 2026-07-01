/**
 * Seed script for AetherRun.
 * Run with: `bun run db:seed` (or `bun prisma/seed.ts`)
 *
 * Seeds:
 *   - 2 demo users (one FREE, one PREMIUM) so the priority queue can be
 *     demonstrated end-to-end.
 *   - 4 algorithmic problems (A+B, FizzBuzz, Factorial, Palindrome) with
 *     a mix of sample (visible) and hidden test cases.
 *   - Each problem's test cases are ordered so the worker can short-circuit
 *     on the first failing case.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding AetherRun database...')

  // ─── Users ────────────────────────────────────────────────────────────
  const freeUser = await db.user.upsert({
    where: { username: 'demo_free' },
    update: {},
    create: {
      username: 'demo_free',
      email: 'demo_free@aether.run',
      subscriptionTier: 'FREE',
    },
  })

  const premiumUser = await db.user.upsert({
    where: { username: 'demo_pro' },
    update: {},
    create: {
      username: 'demo_pro',
      email: 'demo_pro@aether.run',
      subscriptionTier: 'PREMIUM',
    },
  })

  // ─── Problem 1: A + B ───────────────────────────────────────────────
  const sumProblem = await db.problem.upsert({
    where: { id: 'prob_sum' },
    update: {},
    create: {
      id: 'prob_sum',
      title: 'A + B Problem',
      description: `# A + B Problem

Read two integers \`a\` and \`b\` from standard input and print their sum.

## Input
Two space-separated integers \`a\` and \`b\` on a single line.

## Output
A single integer — the sum \`a + b\`.

## Constraints
- \`-10^9 ≤ a, b ≤ 10^9\`

## Example
**Input:** \`3 5\`
**Output:** \`8\``,
      timeLimit: 2000,
      cpuTimeLimit: 2000,
      memoryLimit: 256,
      difficulty: 'EASY',
      tags: 'io,math,warmup',
    },
  })

  await db.testCase.deleteMany({ where: { problemId: sumProblem.id } })
  await db.testCase.createMany({
    data: [
      { problemId: sumProblem.id, input: '3 5\n', expectedOutput: '8\n', isHidden: false, order: 0 },
      { problemId: sumProblem.id, input: '-10 20\n', expectedOutput: '10\n', isHidden: false, order: 1 },
      { problemId: sumProblem.id, input: '0 0\n', expectedOutput: '0\n', isHidden: true, order: 2 },
      { problemId: sumProblem.id, input: '1000000000 1000000000\n', expectedOutput: '2000000000\n', isHidden: true, order: 3 },
      { problemId: sumProblem.id, input: '-1000000000 -1000000000\n', expectedOutput: '-2000000000\n', isHidden: true, order: 4 },
    ],
  })

  // ─── Problem 2: FizzBuzz ────────────────────────────────────────────
  const fizzProblem = await db.problem.upsert({
    where: { id: 'prob_fizzbuzz' },
    update: {},
    create: {
      id: 'prob_fizzbuzz',
      title: 'FizzBuzz',
      description: `# FizzBuzz

Print the numbers from 1 to \`n\` (inclusive), one per line. But:
- For multiples of 3, print \`Fizz\` instead of the number.
- For multiples of 5, print \`Buzz\` instead of the number.
- For multiples of both 3 and 5, print \`FizzBuzz\`.

## Input
A single integer \`n\` (\`1 ≤ n ≤ 100\`).

## Example
**Input:** \`15\`
**Output:**
\`\`\`
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
\`\`\``,
      timeLimit: 2000,
      cpuTimeLimit: 2000,
      memoryLimit: 256,
      difficulty: 'EASY',
      tags: 'io,math,conditional',
    },
  })

  await db.testCase.deleteMany({ where: { problemId: fizzProblem.id } })
  await db.testCase.createMany({
    data: [
      {
        problemId: fizzProblem.id,
        input: '15\n',
        expectedOutput: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n',
        isHidden: false,
        order: 0,
      },
      {
        problemId: fizzProblem.id,
        input: '5\n',
        expectedOutput: '1\n2\nFizz\n4\nBuzz\n',
        isHidden: false,
        order: 1,
      },
      {
        problemId: fizzProblem.id,
        input: '3\n',
        expectedOutput: '1\n2\nFizz\n',
        isHidden: true,
        order: 2,
      },
    ],
  })

  // ─── Problem 3: Factorial ───────────────────────────────────────────
  const factProblem = await db.problem.upsert({
    where: { id: 'prob_factorial' },
    update: {},
    create: {
      id: 'prob_factorial',
      title: 'Factorial',
      description: `# Factorial

Compute \`n!\` (n factorial). Read \`n\` from stdin and print the result.

## Constraints
- \`0 ≤ n ≤ 20\` (result fits in a 64-bit integer)

## Example
**Input:** \`5\`
**Output:** \`120\``,
      timeLimit: 1000,
      cpuTimeLimit: 1000,
      memoryLimit: 128,
      difficulty: 'MEDIUM',
      tags: 'math,recursion,bigint',
    },
  })

  await db.testCase.deleteMany({ where: { problemId: factProblem.id } })
  await db.testCase.createMany({
    data: [
      { problemId: factProblem.id, input: '5\n', expectedOutput: '120\n', isHidden: false, order: 0 },
      { problemId: factProblem.id, input: '0\n', expectedOutput: '1\n', isHidden: false, order: 1 },
      { problemId: factProblem.id, input: '10\n', expectedOutput: '3628800\n', isHidden: true, order: 2 },
      { problemId: factProblem.id, input: '20\n', expectedOutput: '2432902008176640000\n', isHidden: true, order: 3 },
    ],
  })

  // ─── Problem 4: Palindrome Check ───────────────────────────────────
  const palinProblem = await db.problem.upsert({
    where: { id: 'prob_palindrome' },
    update: {},
    create: {
      id: 'prob_palindrome',
      title: 'Palindrome String',
      description: `# Palindrome String

Read a string \`s\` (length \`1 ≤ |s| ≤ 1000\`, lowercase ASCII letters only)
and print \`YES\` if it is a palindrome, otherwise \`NO\`.

## Example
**Input:** \`racecar\`
**Output:** \`YES\`

**Input:** \`hello\`
**Output:** \`NO\``,
      timeLimit: 1000,
      cpuTimeLimit: 1000,
      memoryLimit: 128,
      difficulty: 'EASY',
      tags: 'string,two-pointer',
    },
  })

  await db.testCase.deleteMany({ where: { problemId: palinProblem.id } })
  await db.testCase.createMany({
    data: [
      { problemId: palinProblem.id, input: 'racecar\n', expectedOutput: 'YES\n', isHidden: false, order: 0 },
      { problemId: palinProblem.id, input: 'hello\n', expectedOutput: 'NO\n', isHidden: false, order: 1 },
      { problemId: palinProblem.id, input: 'a\n', expectedOutput: 'YES\n', isHidden: true, order: 2 },
      { problemId: palinProblem.id, input: 'abba\n', expectedOutput: 'YES\n', isHidden: true, order: 3 },
      { problemId: palinProblem.id, input: 'abcabc\n', expectedOutput: 'NO\n', isHidden: true, order: 4 },
    ],
  })

  console.log(`✅ Seeded 2 users, 4 problems with test cases`)
  console.log(`   - FREE user:   ${freeUser.username} (${freeUser.id})`)
  console.log(`   - PREMIUM user: ${premiumUser.username} (${premiumUser.id})`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e)
    await db.$disconnect()
    process.exit(1)
  })
