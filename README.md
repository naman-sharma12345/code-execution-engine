# AetherRun — Distributed Code Execution Engine

> A portfolio-grade, multi-language code execution engine inspired by LeetCode and Codeforces. Built with TypeScript, Next.js 16, Prisma, and a BullMQ-compatible priority queue. Real-time execution streaming via Server-Sent Events.

![AetherRun](https://img.shields.io/badge/AetherRun-v1.0-emerald) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AetherRun Architecture                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    POST /api/submissions    ┌──────────────────┐   │
│  │  Browser    │ ───────────────────────────► │  Next.js API     │   │
│  │  (React)    │                              │  (REST + SSE)    │   │
│  │             │ ◄────────────────────────── │                  │   │
│  │  EventSource│    SSE stream (real-time)   │  ┌────────────┐  │   │
│  └─────────────┘                              │  │ RateLimit  │  │   │
│                                               │  │ Middleware │  │   │
│                                               │  └─────┬──────┘  │   │
│                                               │        ▼         │   │
│                                               │  ┌────────────┐  │   │
│                                               │  │ Submission │  │   │
│                                               │  │ Service    │  │   │
│                                               │  └─────┬──────┘  │   │
│                                               └────────┼──────────┘   │
│                                                        │              │
│                                                        ▼              │
│                                               ┌──────────────────┐   │
│                                               │  Priority Queue  │   │
│                                               │  (BullMQ-compat) │   │
│                                               │  PREMIUM > FREE  │   │
│                                               └────────┬─────────┘   │
│                                                        │              │
│                                       ┌────────────────┼─────────┐    │
│                                       ▼                ▼         ▼    │
│                                  ┌─────────┐    ┌─────────┐ ┌─────┐  │
│                                  │ Worker 1│    │ Worker 2│ │ ... │  │
│                                  │ (polls) │    │ (polls) │ │     │  │
│                                  └────┬────┘    └────┬────┘ └─────┘  │
│                                       │              │               │
│                                       ▼              ▼               │
│                                  ┌──────────────────────────────┐    │
│                                  │  Language Runner (Factory)   │    │
│                                  │  ┌────┐ ┌────┐ ┌───┐ ┌────┐ │    │
│                                  │  │ JS │ │ Py │ │C++│ │Java│ │    │
│                                  │  └────┘ └────┘ └───┘ └────┘ │    │
│                                  └──────────────┬───────────────┘    │
│                                                 │                    │
│                                                 ▼                    │
│                                  ┌──────────────────────────────┐    │
│                                  │  Sandbox (child_process)     │    │
│                                  │  • Time limit (wall-clock)   │    │
│                                  │  • Memory limit (--max-old)  │    │
│                                  │  • Process group kill        │    │
│                                  │  • Stripped env vars         │    │
│                                  │  • Auto-cleanup              │    │
│                                  └──────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Multi-Language Support (Abstract Factory Pattern)

Each language is a self-contained `LanguageRunner` class that knows how to compile and execute its code. The `RunnerFactory` returns the right runner based on the submission's language.

| Language   | Runner Class       | Compile            | Execute                              | Isolation                                              |
|------------|--------------------|--------------------|--------------------------------------|--------------------------------------------------------|
| JavaScript | `JavaScriptRunner` | None (interpreted) | `node Main.js`                       | `--max-old-space-size` heap cap, process group kill    |
| Python     | `PythonRunner`     | None (interpreted) | `python3 -u Main.py`                 | Unbuffered I/O, stripped env                           |
| C++        | `CppRunner`        | `g++ -std=c++17`   | `./Main`                             | Compiled binary, process group kill                    |
| Java       | `JavaRunner`       | `javac Main.java`  | `java -cp <workdir> Main`            | `-Xmx` heap cap, classpath isolation                   |

**Adding a new language = 1 new class + 1 line in the factory.** The worker never changes.

### Resource Isolation & Limits

| Limit          | Enforcement Mechanism                                                         |
|----------------|-------------------------------------------------------------------------------|
| **Wall-clock time** | `setTimeout` + `process.kill(-pgid, SIGKILL)` kills the entire process tree |
| **Memory**     | Runtime flags (`--max-old-space-size` for Node, `-Xmx` for Java) + `/proc/<pid>/status` RSS sampling at 5ms intervals |
| **Processes**  | Process group isolation — `detached: true` ensures we can kill all children  |
| **Network**    | Stripped environment (no secrets in env vars) + Docker `NetworkDisabled: true` in production |
| **Stdout cap** | 1 MB per test case to prevent OOM on infinite-output programs                 |

### Priority Queue (BullMQ-Compatible)

The `SubmissionQueue` class mirrors BullMQ's API:

- **Priority**: PREMIUM (priority 10) > FREE (priority 1). FIFO within the same priority.
- **Retries**: Exponential backoff (1s, 2s, 4s, 8s, 16s) with configurable max attempts.
- **Dead-letter queue**: Permanently failed jobs are moved to DLQ for inspection.
- **Events**: `added`, `active`, `completed`, `failed`, `retry`, `dead-lettered`.

> **Swap to real BullMQ**: Replace `src/queue/SubmissionQueue.ts` with `new Queue(...)` / `new Worker(...)` from `bullmq`. The consumer code (worker, services) stays identical.

### Worker Pool

- Configurable concurrency (default: 4 workers, capped at CPU count).
- Each worker polls the queue with a 50ms interval.
- Locking prevents double-dispatch of the same job.
- Per-test-case short-circuit: hard failures (TLE/MLE/RTE) abort the loop, matching LeetCode UX.

### Real-Time Streaming (SSE)

The frontend opens an `EventSource` connection to `/api/submissions/:id/stream` and receives:

1. `status` events — PENDING → COMPILING → RUNNING → terminal
2. `compile` events — compiler stdout/stderr
3. `log` events — "Test case 3/10 (hidden)…"
4. `testcase` events — per-test-case result (stdout, stderr, exit code, time, memory)
5. `final` event — terminal verdict with full result

Events are buffered for 5 minutes, so late-arriving clients see the full history.

> **Why SSE instead of Socket.io?** SSE runs natively inside Next.js — no separate process, no port conflicts, auto-reconnect built into the browser. The Socket.io mini-service is also included (`mini-services/execution-engine/`) for environments that prefer it.

### Custom Checker Interface

Problems can declare a checker by name:

- `exact` — Whitespace-trimmed line-by-line comparison (default).
- `tolerance` — Floating-point tolerance (1e-6).

Adding a new checker = 1 new class implementing the `Checker` interface + 1 line in the registry.

### Container Pooling (Production)

The `ContainerPoolService` maintains a pool of pre-warmed Docker containers per language. In production, this shaves 200-500ms of container spawn latency per submission (5-10x throughput win). The pool tracks `idle` / `in-use` / `total` per language and exposes stats via `/api/stats`.

### Rate Limiting (Sliding Window)

Redis-style sliding window rate limiter implemented in-memory:

- Default: 5 submissions per minute per user.
- Returns `429 Too Many Requests` with `Retry-After` header.
- Periodic cleanup prevents memory leaks.

> **Swap to Redis**: Replace `src/services/RateLimiter.ts` with `ioredis` ZADD/ZREMRANGEBYSCORE/ZCARD. The middleware code stays identical.

---

## Database Schema

```
User           Problem          TestCase          Submission         ExecutionLog
─────          ───────          ─────────          ──────────         ───────────
id             id               id                id                 id
username       title            problemId ──►     problemId          submissionId ──►
email          description      input             userId             testCaseId ──►
subscription   timeLimit        expectedOutput    language           status
createdAt      memoryLimit      isHidden          code               stdout
               difficulty       order             status             stderr
               tags                                executionTime     exitCode
                                                   memoryUsed         executionTime
                                                   testCasesPassed    memoryUsed
                                                   totalTestCases
                                                   errorMessage
                                                   compileOutput
                                                   completedAt
```

---

## Project Structure

```
/aether-run
├── /src
│   ├── /domain          # Types, Enums, Checker interface (single source of truth)
│   ├── /languages       # Abstract LanguageRunner + 4 concrete runners + Factory
│   ├── /queue           # BullMQ-compatible SubmissionQueue (priority, retries, DLQ)
│   ├── /services        # SubmissionService, TestCaseService, ContainerPool, RateLimiter, EventBridge
│   ├── /workers         # QueueWorker + WorkerPool (polls queue, runs submissions)
│   ├── /app/api         # REST routes + SSE stream route
│   ├── /components/aether  # React UI components
│   └── /hooks           # useSubmissionStream (SSE hook)
├── /mini-services
│   └── /execution-engine  # Socket.io service (alternative to SSE)
├── /prisma
│   ├── schema.prisma    # Database schema
│   └── seed.ts          # Seed data (2 users, 4 problems, test cases)
├── /docker
│   └── Dockerfile.base  # Secure base image for execution containers
├── .env.example
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 22+ (or Bun)
- Python 3.12+
- g++ 14+
- OpenJDK 21+ (for Java support)

### Installation

```bash
# Install dependencies
bun install

# Set up the database
bun run db:push
bun run db:seed

# Start the dev server (Next.js + workers + Socket.io mini-service)
bun run dev
```

The app is available at `http://localhost:3000`.

### Usage

1. **Pick a problem** from the left sidebar (A+B, FizzBuzz, Factorial, Palindrome).
2. **Pick a language** — JavaScript, Python, C++, or Java.
3. **Write your solution** in the code editor (starter code is pre-loaded).
4. **Click Submit** (or press ⌘+Enter).
5. **Watch the execution panel** — real-time logs stream via SSE:
   - Status transitions (PENDING → COMPILING → RUNNING → ACCEPTED)
   - Per-test-case results with time/memory
   - Final verdict

### Demo Users

| Username    | Tier    | Priority |
|-------------|---------|----------|
| `demo_free` | FREE    | 1        |
| `demo_pro`  | PREMIUM | 10       |

Switch users via the picker in the top-right to see priority queueing in action.

---

## API Reference

| Method | Endpoint                              | Description                          |
|--------|---------------------------------------|--------------------------------------|
| GET    | `/api/problems`                       | List all problems                    |
| GET    | `/api/problems/:id`                   | Get problem + sample test cases      |
| POST   | `/api/submissions`                    | Submit code for execution            |
| GET    | `/api/submissions`                    | List recent submissions              |
| GET    | `/api/submissions/:id`                | Get submission + per-test-case logs  |
| GET    | `/api/submissions/:id/stream`         | SSE stream of execution events       |
| GET    | `/api/stats`                          | Engine stats (queue, workers, pool)  |
| GET    | `/api/users`                          | List users                           |
| POST   | `/api/users`                          | Login (returns session token)        |
| GET    | `/api/leaderboard`                    | Top users by accepted submissions    |

---

## Advanced Features

### Container Pooling

Instead of creating a new Docker container for every submission (200-500ms overhead), the `ContainerPoolService` maintains a pool of pre-warmed containers per language. When a job arrives, the pool hands out an idle container; the worker copies code in, runs it, and returns the container to the pool.

### cgroup-Style Resource Limits

In Docker mode, each container is spawned with:
```typescript
{
  Memory: memoryLimitBytes,     // --memory=256m
  NanoCpus: cpuLimit * 1e9,     // --cpus=1.0
  PidsLimit: 50,                // --pids-limit=50 (anti fork-bomb)
  NetworkDisabled: true,        // no outbound network
  User: 'runner',               // non-root
  HostConfig: {
    AutoRemove: true,           // cleanup after exit
    ReadonlyRootfs: true,       // read-only filesystem
    Binds: [{ Source: codePath, Target: '/workspace/code', ReadOnly: true }],
  },
}
```

### BullMQ Priority Queues

The queue implementation mirrors BullMQ's API exactly. Swapping to real BullMQ + Redis is a 1-file change:

```typescript
// Before (in-memory):
import { getQueue } from '@/queue/SubmissionQueue'
const queue = getQueue()
queue.add(payload, priority)

// After (BullMQ + Redis):
import { Queue } from 'bullmq'
const queue = new Queue('submissions', { connection: { host: 'localhost', port: 6379 } })
queue.add('submit', payload, { priority })
```

---

## Tech Stack

| Layer            | Technology                                         |
|------------------|----------------------------------------------------|
| Frontend         | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Backend          | Next.js API Routes (REST + SSE)                    |
| Database         | Prisma ORM + SQLite (local) / PostgreSQL (prod)    |
| Queue            | In-memory BullMQ-compatible queue (Redis for prod) |
| Real-time        | Server-Sent Events (Socket.io mini-service optional) |
| Execution        | Node.js child_process with process-group isolation |
| Languages        | JavaScript (Node 22), Python 3.12, C++ 17 (g++ 14), Java 21 |

---

## License

MIT — Built as a BTech 3rd-year portfolio project.
