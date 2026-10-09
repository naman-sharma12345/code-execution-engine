// Process sandbox: fork/exec with rlimits, its own process group, wall-clock
// deadline, live RSS monitoring, output caps. No shell is ever involved.
#pragma once
#include <string>
#include <vector>

namespace aether {

struct RunLimits {
  long long wall_ms = 2000;
  long long cpu_ms = 0;               // RLIMIT_CPU backstop (rounded up to whole seconds); 0 = none
  long long memory_kb = 256 * 1024;   // live-enforced via RSS sampling; exceeding kills the group
  long long address_space_kb = 0;     // RLIMIT_AS; 0 = unlimited (needed off for JVM/V8)
  size_t output_limit = 1 << 20;      // per stream; exceeding kills the process
  long long file_size_kb = 16 * 1024; // RLIMIT_FSIZE
  int max_processes = 0;              // RLIMIT_NPROC; 0 = unlimited (see README caveat)
  int max_open_files = 64;
  int max_group_procs = 64;           // kill when the process group grows beyond this (fork bombs); 0 = off
};

struct RunSpec {
  std::vector<std::string> argv;  // argv[0] is the executable (looked up in env PATH if no '/')
  std::string cwd;
  std::vector<std::string> env;   // "K=V"
  std::string stdin_data;
  RunLimits limits;
};

struct RunOutcome {
  bool spawn_failed = false;
  std::string error;           // spawn error text
  int exit_code = -1;          // -1 when killed by signal
  int term_signal = 0;
  std::string out, err;
  long long wall_ms = 0;
  long long cpu_ms = 0;
  long long peak_rss_kb = 0;
  bool timed_out = false;
  bool memory_exceeded = false;
  bool output_exceeded = false;
  bool process_limit_exceeded = false;
};

RunOutcome run_sandboxed(const RunSpec& spec);

// Best-effort kill of an entire process group (used by tests / shutdown).
void kill_group(int pgid);

}  // namespace aether
