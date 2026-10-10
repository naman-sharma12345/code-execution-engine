# TypeScript engine vs C++ engine

Behavior differences found while porting `src/` to `cpp/`. Each row is covered by a test in `cpp/tests`.

| Area | TypeScript original | C++ rewrite |
| --- | --- | --- |
| Exact checker | Rejected correct output that lacked a trailing newline | Normalizes trailing whitespace, still strict on content |
| Memory limit | Not enforced while the program ran | Live RSS sampling of the whole process group, kill on breach (MLE) |
| Fork bombs | Not handled | Group size cap, plus RLIMIT_NPROC backstop sized to current load |
| Escaped processes | Left running after the judge finished | Tagged by environment marker and killed after every run, including `setsid()` escapees |
| Hidden tests | Hidden input could leak through stdout | Hidden input and expected output redacted in all responses |
| Infra failures | Marked as a user failure | Retried with capped backoff, then dead-lettered |
| Rate limit | Charged before request validation | Charged only after validation |
| Auth | Unknown token or userId mapped to another user | Rejected with 401 |
| Output flood | Buffered without a bound | Per-stream cap, process killed on breach |
| Network | Untrusted code could open sockets | Empty network namespace per run when the kernel allows it (best effort, see README) |
| Server state | Readable via /proc by submitted code | Server is non-dumpable, work dirs under a private 0300 root |
| Output storage | Whole output kept per case | 16 KB cap per case, verified by a 300-submission soak test (flat RSS) |
| Dependencies | Node, Next.js, Prisma, SQLite | None beyond the C++17 standard library and POSIX |

Wire format: the C++ server returns the JSON shapes `src/lib/api.ts` expects, so the existing UI works unchanged when `AETHER_CPP_BACKEND` points Next.js at it.

Persistence: optional. Set `AETHER_PERSIST` to a file path for owner-only JSONL history that survives restarts. Without it, state stays in memory. The Prisma database still belongs to the TypeScript app.
