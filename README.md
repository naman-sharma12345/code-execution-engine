<p align="center">
  <h1 align="center">⚡ AetherRun</h1>
  <h3 align="center">Distributed Code Execution Engine</h3>
  <p align="center">
    A production-grade, multi-language code execution platform inspired by LeetCode & Codeforces.<br>
    Real-time execution streaming • Sandboxed isolation • Priority queues • Built from scratch.
  </p>
  <p align="center">
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js_16-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js"></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React"></a>
    <a href="https://www.prisma.io/"><img src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma"></a>
    <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS_4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind"></a>
  </p>
</p>

---

> **4 Languages** (JS • Python • C++ • Java) &nbsp;|&nbsp; **Real-Time SSE** (Live execution streaming) &nbsp;|&nbsp; **Priority Queue** (BullMQ-compatible) &nbsp;|&nbsp; **Sandboxed** (Process-group isolation)

---

## ⚡ C++ engine (cpp/)

A dependency-free C++17 rewrite of the execution backend lives in [`cpp/`](cpp/). It serves the same `/api/*` contract, so the existing UI runs on it unchanged:

```bash
cmake -S cpp -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
./build/aether_tests                     # 79 tests
AETHER_PORT=3001 AETHER_PROBLEMS=cpp/data/problems.json ./build/aetherrun
AETHER_CPP_BACKEND=http://127.0.0.1:3001 npm run dev   # UI proxies /api/* to C++
```

It fixes several bugs in the TypeScript engine (trailing-newline checker bug, live memory limit, fork-bomb and `setsid()` escape handling, hidden-test leakage) and adds optional JSONL persistence, graceful shutdown, a best-effort per-run network namespace, a private work-dir root, bounded output storage and a cross-language soak test (`cpp/tests/soak.py`). The sandbox is process-level, not a container: run it inside Docker or a VM for untrusted code (details in [`cpp/README.md`](cpp/README.md)). CI runs the suite plain, under ASAN/UBSAN, under TSAN, and against a built Docker image. See [`cpp/COMPARISON.md`](cpp/COMPARISON.md) for the full list.

## 🎯 What is AetherRun?

AetherRun is a **full-stack distributed code execution engine** — the kind of system that powers platforms like LeetCode, HackerRank, and Codeforces. It accepts user code in 4 languages, compiles it (if needed), runs it against test cases inside sandboxed environments, and streams the results back to the browser **in real-time** via Server-Sent Events.

This isn't a toy REPL. It's a **systems-level project** that demonstrates:

- **Distributed systems concepts** — priority queuing, worker pools, dead-letter queues, exponential backoff retries
- **Security engineering** — process-group isolation, stripped environments, memory/time limits, stdout capping
- **Software architecture** — Abstract Factory pattern, Strategy pattern, event-driven architecture, clean layered design
- **Real-time systems** — SSE streaming with event buffering for late-arriving clients
- **Production readiness** — rate limiting, container pooling, graceful error handling, database persistence

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         AetherRun — System Architecture                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    POST /api/submissions      ┌──────────────────────┐     │
│  │   Browser    │ ──────────────────────────►   │   Next.js API Layer  │     │
│  │   (React)    │                               │                      │     │
│  │             ┌┤   SSE stream (real-time)      │  ┌────────────────┐  │     │
│  │  EventSource││ ◄──────────────────────────── │  │  Rate Limiter  │  │     │
│  │             └┤                               │  │ (sliding window│  │     │
│  └─────────────┘                                │  │  5 req/min)    │  │     │
│                                                 │  └───────┬────────┘  │     │
│                                                 │          ▼           │     │
│                                                 │  ┌────────────────┐  │     │
│                                                 │  │  Submission    │  │     │
│                                                 │  │  Service       │  │     │
│                                                 │  │  (validate →   │  │     │
│                                                 │  │   persist →    │  │     │
│                                                 │  │   enqueue)     │  │     │
│                                                 │  └───────┬────────┘  │     │
│                                                 └──────────┼───────────┘     │
│                                                            ▼                 │
│                                                 ┌──────────────────────┐     │
│                                                 │   Priority Queue     │     │
│                                                 │   (BullMQ-compat)    │     │
│                                                 │                      │     │
│                                                 │  PREMIUM(10) > FREE(1)     │
│                                                 │  FIFO within priority│     │
│                                                 │  Exp. backoff retries│     │
│                                                 │  Dead-letter queue   │     │
│                                                 └──────────┬───────────┘     │
│                                                            │                 │
│                                          ┌─────────────────┼──────────┐      │
│                                          ▼                 ▼          ▼      │
│                                     ┌─────────┐     ┌─────────┐ ┌────────┐  │
│                                     │Worker 1 │     │Worker 2 │ │Worker N│  │
│                                     │ (polls) │     │ (polls) │ │(polls) │  │
│                                     └────┬────┘     └────┬────┘ └───┬────┘  │
│                                          │               │          │        │
│                                          ▼               ▼          ▼        │
│                                     ┌────────────────────────────────────┐   │
│                                     │  Language Runner (Abstract Factory) │  │
│                                     │   ┌──────┐ ┌──────┐ ┌────┐ ┌────┐ │   │
│                                     │   │  JS  │ │  Py  │ │C++ │ │Java│ │   │
│                                     │   └──────┘ └──────┘ └────┘ └────┘ │   │
│                                     └────────────────┬───────────────────┘   │
│                                                      ▼                       │
│                                     ┌────────────────────────────────────┐   │
│                                     │   Sandboxed Execution              │   │
│                                     │   • Process-group isolation        │   │
│                                     │   • Wall-clock time limit          │   │
│                                     │   • Memory limit (RSS sampling)    │   │
│                                     │   • Stripped env (no secrets)       │   │
│                                     │   • Stdout cap (1MB)               │   │
│                                     │   • Auto-cleanup of /tmp           │   │
│                                     └────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 🌐 Multi-Language Execution (Abstract Factory Pattern)

Each language is a self-contained `LanguageRunner` class implementing a uniform interface. The `RunnerFactory` returns the correct runner — **adding a new language = 1 new class + 1 line in the factory**. The worker never changes.

| Language | Runner | Compile Step | Execute Command | Memory Isolation |
|:---------|:-------|:-------------|:----------------|:-----------------|
| **JavaScript** | `JavaScriptRunner` | None (interpreted) | `node Main.js` | `--max-old-space-size` heap cap |
| **Python** | `PythonRunner` | None (interpreted) | `python3 -u Main.py` | Unbuffered I/O, stripped env |
| **C++ 17** | `CppRunner` | `g++ -std=c++17` | `./Main` | Compiled binary, pgid kill |
| **Java 21** | `JavaRunner` | `javac Main.java` | `java -cp <workdir> Main` | `-Xmx` heap cap, classpath isolation |

```typescript
// Adding a language is dead simple — 1 class + 1 registry line:
const RUNNERS: Record<Language, LanguageRunner> = {
  javascript: new JavaScriptRunner(),
  python:     new PythonRunner(),
  cpp:        new CppRunner(),
  java:       new JavaRunner(),
  // rust:    new RustRunner(),  ← future: just add this
}
```

---

### 🔒 Sandboxed Execution & Resource Limits

User code runs in strict isolation. Every resource is capped and enforced:

| Resource | Enforcement | Why It Matters |
|:---------|:------------|:---------------|
| **Wall-clock time** | `setTimeout` + `process.kill(-pgid, SIGKILL)` kills the *entire process tree* | Prevents infinite loops from hogging workers |
| **Memory** | Runtime flags (`--max-old-space-size`, `-Xmx`) + `/proc/<pid>/status` RSS sampling at **5ms intervals** | Catches memory bombs before OOM kills the host |
| **Processes** | `detached: true` → own process group → `kill(-pgid)` atomically kills all children | Prevents fork-bomb escapes |
| **Network** | Stripped environment (no DB URLs, no API keys) + Docker `NetworkDisabled: true` in prod | Prevents data exfiltration |
| **Stdout** | **1MB cap** per test case | Prevents infinite-output programs from causing OOM |

```typescript
// The key insight: detached process group isolation
const child = spawn(executable, fullArgv, {
  detached: true,    // own process group → can kill the entire tree
  env: {             // stripped env → no secrets leak to user code
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: workDir,
    LANG: 'C.UTF-8',
  },
})
```

---

### 📊 Priority Queue (BullMQ-Compatible API)

A **production-grade priority queue** built from scratch with the exact same API as BullMQ — swapping to real BullMQ + Redis is a **1-file change**.

```
                ┌─── Priority 10 (PREMIUM) ───┐
                │   dequeued FIRST (FIFO)      │
                ├──────────────────────────────┤
                │   Priority 1 (FREE)          │
                │   dequeued AFTER premium     │
                └──────────────────────────────┘
```

**Features implemented:**

- ⚡ **Priority scheduling** — `PREMIUM (10) > FREE (1)`, FIFO within same priority
- 🔄 **Exponential backoff retries** — 1s → 2s → 4s → 8s → 16s (configurable)
- 💀 **Dead-letter queue** — permanently failed jobs moved to DLQ for inspection
- 🔒 **Concurrency locking** — `activeJobs` Set prevents double-dispatch across workers
- 📡 **Event emission** — `added`, `active`, `completed`, `failed`, `retry`, `dead-lettered`

```typescript
// Swapping to real BullMQ is a 1-file change:

// Before (in-memory):
import { getQueue } from '@/queue/SubmissionQueue'
const queue = getQueue()
queue.add(payload, priority)

// After (BullMQ + Redis):
import { Queue } from 'bullmq'
const queue = new Queue('submissions', { connection: redis })
queue.add('submit', payload, { priority })
```

---

### ⚡ Real-Time Streaming (Server-Sent Events)

Execution results stream to the browser **as they happen**. No polling, no WebSocket overhead — just native SSE running inside Next.js API routes.

**Event types streamed to the client:**

| Event | Description | Example |
|:------|:------------|:--------|
| `status` | Lifecycle transitions | `PENDING → COMPILING → RUNNING → ACCEPTED` |
| `compile` | Compiler stdout/stderr | `g++: error: 'cout' was not declared` |
| `log` | Progress messages | `Test case 3/10 (hidden)…` |
| `testcase` | Per-test-case result | `{ status: 'ACCEPTED', time: 45ms, memory: 12MB }` |
| `final` | Terminal verdict with full results | `{ status: 'ACCEPTED', passed: 10/10 }` |

**Late-client buffering:** Events are buffered for 5 minutes, so a client that connects *after* execution starts still sees the full event history — no missed events.

> **Why SSE over Socket.io?** SSE runs natively inside Next.js — no separate process, no port conflicts, auto-reconnect built into the browser. A Socket.io mini-service is also included for environments that need bidirectional communication.

---

### 🏎️ Worker Pool

- **Configurable concurrency** — default: `min(4, cpuCount)` workers
- **50ms poll interval** — keeps latency low without burning CPU
- **Lock-free dequeue** — `activeJobs` Set prevents double-dispatch
- **Short-circuit on hard failure** — TLE/MLE/RTE aborts the test loop immediately (matches LeetCode UX)
- **Graceful error handling** — infrastructure crashes trigger queue retry with backoff

---

### 🧪 Pluggable Checker System (Strategy Pattern)

Problems can declare custom output comparison strategies:

| Checker | Behavior | Use Case |
|:--------|:---------|:---------|
| `exact` | Whitespace-trimmed line-by-line comparison | Default for most problems |
| `tolerance` | Floating-point tolerance (1e⁻⁶) | Numerical problems |

```typescript
// Adding a new checker = 1 class + 1 registry line:
export interface Checker {
  check(testCase: TestCaseData, actual: string): { accepted: boolean; reason?: string }
}
```

---

### 🐳 Container Pooling (Production)

The `ContainerPoolService` maintains **pre-warmed Docker containers per language**. In production, this shaves **200-500ms** of container spawn latency per submission — a **5-10× throughput improvement**.

```
Container Pool Stats:
┌────────────┬───────┬──────┬────────┐
│ Language   │ Total │ Idle │ In-Use │
├────────────┼───────┼──────┼────────┤
│ JavaScript │   3   │  2   │   1    │
│ Python     │   3   │  3   │   0    │
│ C++        │   3   │  3   │   0    │
│ Java       │   3   │  2   │   1    │
└────────────┴───────┴──────┴────────┘
```

---

### 🛡️ Rate Limiting (Sliding Window)

Redis-style sliding-window rate limiter — prevents abuse without blocking legitimate users:

- **5 submissions per minute** per user (configurable)
- Returns `429 Too Many Requests` with `Retry-After` header
- Periodic cleanup prevents memory leaks
- **Swap to Redis:** Replace with `ioredis` `ZADD`/`ZREMRANGEBYSCORE`/`ZCARD` — middleware code stays identical

---

## 🗃️ Database Schema

```
User              Problem            TestCase            Submission           ExecutionLog
─────             ───────            ────────            ──────────           ────────────
id (cuid)         id (cuid)          id (cuid)           id (cuid)            id (cuid)
username ⊕        title              problemId FK──►     problemId FK──►      submissionId FK──►
email ⊕           description        input               userId FK──►         testCaseId FK──►
subscriptionTier  timeLimit (ms)     expectedOutput      language             status
createdAt         cpuTimeLimit       isHidden            code                 stdout
                  memoryLimit (MB)   order               status               stderr
                  difficulty                             executionTime        exitCode
                  tags                                   memoryUsed           executionTime
                                                         testCasesPassed      memoryUsed
                                                         totalTestCases       createdAt
                                                         errorMessage
                                                         compileOutput
                                                         completedAt

⊕ = unique index    FK = foreign key with cascading delete
```

---

## 📂 Project Structure

```
aetherrun/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── problems/            # GET /api/problems, GET /api/problems/:id
│   │   │   ├── submissions/         # POST /api/submissions, GET, SSE stream
│   │   │   ├── users/               # GET /api/users, POST (login)
│   │   │   ├── leaderboard/         # GET /api/leaderboard
│   │   │   └── stats/               # GET /api/stats (engine telemetry)
│   │   ├── page.tsx                 # Main IDE layout (resizable panels)
│   │   ├── layout.tsx               # Root layout with Geist fonts
│   │   └── globals.css              # Custom theme (charcoal + violet)
│   │
│   ├── components/
│   │   ├── aether/                  # App-specific components
│   │   │   ├── code-editor.tsx      # Syntax-highlighted code editor
│   │   │   ├── execution-panel.tsx  # Real-time execution log viewer
│   │   │   ├── problem-sidebar.tsx  # Problem list, leaderboard, history
│   │   │   ├── problem-viewer.tsx   # Tabbed problem viewer (desc/samples/notes)
│   │   │   ├── header.tsx           # Top bar with live engine indicator
│   │   │   ├── stats-bar.tsx        # Bottom stats bar (queue/workers/uptime)
│   │   │   └── verdict-badge.tsx    # Animated verdict status badges
│   │   └── ui/                      # shadcn/ui primitives (30+ components)
│   │
│   ├── domain/                      # Single source of truth
│   │   ├── enums.ts                 # Language, Status, Tier (string unions)
│   │   ├── types.ts                 # DTOs: TestCaseData, JobPayload, etc.
│   │   └── checker.ts              # Checker interface + ExactChecker + ToleranceChecker
│   │
│   ├── languages/                   # Abstract Factory pattern
│   │   ├── LanguageRunner.ts        # Abstract base class (compile + run)
│   │   ├── JavaScriptRunner.ts      # Node.js runner
│   │   ├── PythonRunner.ts          # Python 3 runner
│   │   ├── CppRunner.ts            # g++ C++17 runner
│   │   ├── JavaRunner.ts            # OpenJDK 21 runner
│   │   └── RunnerFactory.ts         # Factory + singleton registry
│   │
│   ├── queue/
│   │   └── SubmissionQueue.ts       # BullMQ-compat priority queue with DLQ
│   │
│   ├── services/
│   │   ├── SubmissionService.ts     # Validate → persist → enqueue orchestration
│   │   ├── EventBridge.ts           # In-process event bus (SSE backbone)
│   │   ├── ContainerPoolService.ts  # Pre-warmed container pool per language
│   │   ├── RateLimiter.ts           # Sliding-window rate limiter
│   │   ├── TestCaseService.ts       # Test case CRUD
│   │   ├── AuthService.ts           # User authentication & session
│   │   └── EngineBootstrap.ts       # System initialization on startup
│   │
│   ├── workers/
│   │   └── QueueWorker.ts           # Worker pool (poll → compile → run → emit)
│   │
│   ├── hooks/
│   │   ├── use-submission-stream.ts # SSE hook for real-time events
│   │   ├── use-socket.ts           # Socket.io hook (alternative)
│   │   └── use-toast.ts            # Toast notification hook
│   │
│   └── lib/
│       ├── api.ts                   # Type-safe API client
│       ├── db.ts                    # Prisma client singleton
│       └── utils.ts                 # cn() utility
│
├── prisma/
│   ├── schema.prisma                # 5-model relational schema
│   └── seed.ts                      # Seed: 2 users, 4 problems, test cases
│
├── mini-services/
│   └── execution-engine/            # Socket.io service (alternative to SSE)
│
├── docker/
│   └── Dockerfile.base              # Secure base image for prod containers
│
└── package.json
```

---

## 🎨 Design Patterns & Architecture Decisions

| Pattern | Where | Why |
|:--------|:------|:----|
| **Abstract Factory** | `LanguageRunner` → `RunnerFactory` | New language = 1 class + 1 line. Worker stays unchanged. Open/Closed principle. |
| **Strategy** | `Checker` interface → `ExactChecker`, `ToleranceChecker` | Problems declare their own comparator. Decouples comparison logic from test data. |
| **Observer / Event Bus** | `EventBridge` (EventEmitter) | Workers emit events; SSE routes subscribe. Fully decoupled producer/consumer. |
| **Singleton (HMR-safe)** | `globalThis.__aetherQueue`, `__aetherPool`, `__aetherWorkers` | Prevents duplicate instances during Next.js hot-reload in dev mode. |
| **Service Layer** | `SubmissionService`, `TestCaseService`, `RateLimiter` | Business logic separated from API routes. Routes are thin controllers. |
| **Dead-Letter Queue** | `SubmissionQueue.fail()` → DLQ after max retries | Failed jobs are preserved for inspection, not silently dropped. |
| **Process-Group Isolation** | `spawn({ detached: true })` + `kill(-pgid, SIGKILL)` | Atomically kills entire process tree — prevents fork-bomb escapes. |

---

## 🔌 API Reference

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/problems` | List all problems |
| `GET` | `/api/problems/:id` | Get problem + sample test cases |
| `POST` | `/api/submissions` | Submit code for execution |
| `GET` | `/api/submissions` | List recent submissions |
| `GET` | `/api/submissions/:id` | Get submission + per-test-case logs |
| `GET` | `/api/submissions/:id/stream` | **SSE stream** of real-time execution events |
| `GET` | `/api/stats` | Engine telemetry (queue, workers, pool) |
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Login (returns session token) |
| `GET` | `/api/leaderboard` | Top users by accepted submissions |

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version | Purpose |
|:-----|:--------|:--------|
| Node.js | 22+ | Runtime & worker pool |
| Python | 3.12+ | Python code execution |
| g++ | 14+ | C++ compilation |
| OpenJDK | 21+ | Java compilation & execution |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/naman-sharma12345/code-execution-engine.git
cd code-execution-engine

# 2. Install dependencies
npm install

# 3. Set up the database
npx prisma db push
npx prisma db seed      # Seeds: 2 users, 4 problems, test cases

# 4. Start the dev server
npm run dev
```

The app will be available at **http://localhost:3000**.

### Usage

1. **Pick a problem** from the sidebar (A+B, FizzBuzz, Factorial, Palindrome)
2. **Select a language** — JavaScript, Python, C++, or Java
3. **Write your solution** (starter code is pre-loaded)
4. **Click Submit** (or press `⌘+Enter`)
5. **Watch the execution panel** — real-time logs stream via SSE:
   - Status transitions: `PENDING → COMPILING → RUNNING → ACCEPTED`
   - Per-test-case results with time/memory metrics
   - Final verdict with animated badge

### Demo Users

| Username | Tier | Queue Priority | Purpose |
|:---------|:-----|:---------------|:--------|
| `demo_free` | FREE | 1 (normal) | Standard queue position |
| `demo_pro` | PREMIUM | 10 (high) | Dequeued before FREE users |

> 💡 Switch users via the picker in the top-right to see **priority queuing** in action.

---

## ⚙️ Production Deployment

### Docker Container Security

In Docker mode, each container is spawned with enterprise-grade isolation:

```typescript
{
  Memory: memoryLimitBytes,      // --memory=256m
  NanoCpus: cpuLimit * 1e9,      // --cpus=1.0
  PidsLimit: 50,                  // --pids-limit=50 (anti fork-bomb)
  NetworkDisabled: true,          // no outbound network
  User: 'runner',                 // non-root execution
  HostConfig: {
    AutoRemove: true,             // cleanup after exit
    ReadonlyRootfs: true,         // read-only filesystem
    Binds: [{
      Source: codePath,
      Target: '/workspace/code',
      ReadOnly: true              // user code can't modify its own source
    }],
  },
}
```

### Scaling to BullMQ + Redis

The in-memory queue is a **drop-in replacement** for BullMQ. To scale horizontally:

```bash
# 1. Install BullMQ
npm install bullmq ioredis

# 2. Replace src/queue/SubmissionQueue.ts (the only file that changes)
# 3. Point at your Redis instance
# 4. The rest of the codebase stays identical
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|:------|:-----------|:----|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui | Server-first architecture, type safety, rapid UI development |
| **Backend** | Next.js API Routes (REST + SSE) | Unified deployment, no separate server process |
| **Database** | Prisma ORM + SQLite (dev) / PostgreSQL (prod) | Type-safe queries, zero-config local dev |
| **Queue** | In-memory BullMQ-compatible → Redis (prod) | Same API, swap storage layer without code changes |
| **Real-time** | Server-Sent Events + Socket.io (optional) | Native browser support, auto-reconnect |
| **Execution** | `child_process.spawn` with process-group isolation | OS-level sandboxing without Docker overhead in dev |
| **UI System** | 30+ shadcn/ui components + custom Aether components | Accessible, composable, themeable |

---

## 🎓 What This Project Demonstrates

This project was built to showcase **systems-level engineering skills** at a depth beyond typical CRUD applications:

- **Distributed Systems** — Priority queues, worker pools, dead-letter queues, exponential backoff, idempotent job processing
- **Security** — Process-group isolation, environment stripping, memory sandboxing, stdout capping, rate limiting
- **Design Patterns** — Abstract Factory, Strategy, Observer, Singleton (HMR-safe), Service Layer
- **Real-Time Engineering** — SSE streaming with event buffering, late-client replay, connection lifecycle management
- **Database Design** — Relational schema with proper indexing, cascading deletes, and denormalized counters for query performance
- **Production Architecture** — Container pooling, configurable concurrency, graceful error handling, structured logging

---

<p align="center">
  <b>Built with ☕ and curiosity</b><br>
  <sub>If you found this interesting, consider giving it a ⭐</sub>
</p>
