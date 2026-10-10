# AetherRun C++ engine

A dependency-free C++17 rewrite of the AetherRun execution backend. It serves the same `/api/*` JSON contract the Next.js frontend uses.

## Build and test
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
    ./build/aether_tests          # 59 tests
    AETHER_PORT=3001 AETHER_PROBLEMS=data/problems.json ./build/aetherrun

Env: `AETHER_PORT`, `AETHER_HOST`, `AETHER_WORKERS`, `AETHER_RATE_LIMIT`, `AETHER_MAX_SUBMISSIONS` (finished submissions kept in memory, default 5000), `AETHER_PROBLEMS`.

Benchmark (2-core sandbox VM, 4 workers, Python submissions, 16 concurrent clients): 80/80 ACCEPTED, about 27 judged submissions per second end to end.

## Use with the existing UI
Run the server, then start Next.js with `AETHER_CPP_BACKEND=http://127.0.0.1:3001`. All `/api/*` calls are proxied.

## Docker
    docker build -t aetherrun-cpp cpp && docker run -p 3001:3001 aetherrun-cpp

## Sanitizers
ASAN+UBSAN run clean on the json, checker, rate limiter, queue and engine suites (CI runs them). ThreadSanitizer on GCC 11 reports false races and a "double lock" on every `condition_variable` timed wait, because libtsan 11 does not intercept `pthread_cond_clockwait`. With the waits switched to `system_clock` the queue and engine suites are TSAN-clean, so the reports are tool noise, not engine bugs. Use GCC 13+ or clang for TSAN.

## Sandbox
fork/exec per run with rlimits (CPU, file size, processes), its own process group, wall-clock kill, live memory monitoring, and an output cap. This is not a container: run it inside Docker or a VM for untrusted code.

## Sandbox escape hardening
Runs are tagged with a unique environment marker. After every run, any leftover process carrying the marker is killed, including ones that called `setsid()` to leave the process group.

## Fixes over the TypeScript version
- Exact checker no longer rejects output missing a trailing newline.
- Memory limit is enforced live, not after the fact.
- Hidden test input and expected output are redacted from responses.
- Infrastructure failures are retried with backoff, then dead-lettered.
- Rate limit is charged only after validation.
- Unknown tokens or user ids are rejected, not mapped to another user.

## Network isolation

Each sandboxed program runs in its own empty network namespace (`unshare(CLONE_NEWUSER|CLONE_NEWNET)`),
so submitted code cannot reach the engine's own API, other host services or the internet. This is best
effort: it needs unprivileged user namespaces, which some hosts and the default Docker seccomp profile
refuse. In that case programs run without it (set `AETHER_NO_NETNS=1` to turn it off explicitly). To
make a deployment fail loudly instead, run the tests with `AETHER_REQUIRE_NETNS=1` on the target host.
For untrusted production use, also run the container with `--network none`.

## Persistence (optional)

Set `AETHER_PERSIST=/path/history.jsonl` and finished submissions (code, verdict, per-case results with
stdout/stderr capped at 4 KB) are appended as one JSON line each. On start the file is read back, torn or
corrupt lines are skipped, only the newest `AETHER_MAX_SUBMISSIONS` records are kept, and the file is
compacted atomically. History, leaderboard and SSE replay of old submissions then survive restarts.
Hidden-test output stays redacted. Unset, the engine is purely in-memory as before.

## Graceful shutdown

On SIGTERM/SIGINT the server finishes accepted submissions before exiting, for at most
`AETHER_DRAIN_MS` (default 10000). Anything still unfinished after that is dropped, and the log says so.
With `AETHER_PERSIST` set, drained submissions are written to the history file before exit.

## End-to-end latency

Submit-to-verdict for the A + B problem (5 test cases), 5 runs each, 2 workers, on a 2-core VM,
measured through the HTTP API (`POST /api/submissions`, then polling `GET /api/submissions/:id`):

| Language   | Median | Min    | Max    |
|------------|--------|--------|--------|
| Python     | 65 ms  | 60 ms  | 70 ms  |
| JavaScript | 179 ms | 173 ms | 230 ms |
| C++        | 292 ms | 274 ms | 298 ms |
| Java       | 897 ms | 886 ms | 944 ms |

Most of the time is the language runtime or compiler starting up, not the engine. Throughput with
4 workers is about 27 Python submissions per second.
