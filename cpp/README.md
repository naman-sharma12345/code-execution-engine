# AetherRun C++ engine

A dependency-free C++17 rewrite of the AetherRun execution backend. It serves the same `/api/*` JSON contract the Next.js frontend uses.

## Build and test
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
    ./build/aether_tests          # 59 tests
    AETHER_PORT=3001 AETHER_PROBLEMS=data/problems.json ./build/aetherrun

Env: `AETHER_PORT`, `AETHER_HOST`, `AETHER_WORKERS`, `AETHER_PROBLEMS`.

## Use with the existing UI
Run the server, then start Next.js with `AETHER_CPP_BACKEND=http://127.0.0.1:3001`. All `/api/*` calls are proxied.

## Docker
    docker build -t aetherrun-cpp cpp && docker run -p 3001:3001 aetherrun-cpp

## Sandbox
fork/exec per run with rlimits (CPU, file size, processes), its own process group, wall-clock kill, live memory monitoring, and an output cap. This is not a container: run it inside Docker or a VM for untrusted code.

## Fixes over the TypeScript version
- Exact checker no longer rejects output missing a trailing newline.
- Memory limit is enforced live, not after the fact.
- Hidden test input and expected output are redacted from responses.
- Infrastructure failures are retried with backoff, then dead-lettered.
- Rate limit is charged only after validation.
- Unknown tokens or user ids are rejected, not mapped to another user.
