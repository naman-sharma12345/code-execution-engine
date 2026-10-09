# AetherRun C++ engine

A dependency-free C++17 rewrite of the AetherRun execution backend. It serves the same `/api/*` JSON contract the Next.js frontend uses.

## Build and test
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
    ./build/aether_tests          # 59 tests
    AETHER_PORT=3001 AETHER_PROBLEMS=data/problems.json ./build/aetherrun

Env: `AETHER_PORT`, `AETHER_HOST`, `AETHER_WORKERS`, `AETHER_RATE_LIMIT`, `AETHER_PROBLEMS`.

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
