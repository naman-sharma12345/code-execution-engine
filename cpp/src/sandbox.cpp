#include "aether/sandbox.hpp"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <iterator>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

extern char** environ;

namespace aether {
namespace {

using Clock = std::chrono::steady_clock;

long long ms_since(Clock::time_point t) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t).count();
}

void set_nonblock(int fd) {
  int fl = fcntl(fd, F_GETFL, 0);
  fcntl(fd, F_SETFL, fl | O_NONBLOCK);
}

// Parses "VmHWM:  1234 kB" (peak RSS) from /proc/<pid>/status.
long long read_hwm_kb(pid_t pid) {
  char path[64];
  std::snprintf(path, sizeof path, "/proc/%d/status", static_cast<int>(pid));
  std::ifstream f(path);
  if (!f) return 0;
  std::string line;
  long long best = 0;
  while (std::getline(f, line)) {
    if (line.rfind("VmHWM:", 0) == 0 || line.rfind("VmRSS:", 0) == 0) {
      long long v = std::atoll(line.c_str() + 6);
      best = std::max(best, v);
    }
  }
  return best;
}

struct TreeStat { long long rss_kb = 0; int procs = 0; };

// Sums RSS and counts processes whose process group is `pgid` (the sandboxed tree).
TreeStat scan_group(pid_t pgid) {
  TreeStat t;
  DIR* d = opendir("/proc");
  if (!d) return t;
  while (dirent* e = readdir(d)) {
    if (e->d_name[0] < '1' || e->d_name[0] > '9') continue;
    std::string dname = e->d_name;
    std::ifstream f("/proc/" + dname + "/stat");
    std::string line;
    if (!f || !std::getline(f, line)) continue;
    size_t rp = line.rfind(')');
    if (rp == std::string::npos) continue;
    // fields after ")": state ppid pgrp ...
    char st; int ppid = 0, pg = 0;
    if (std::sscanf(line.c_str() + rp + 2, "%c %d %d", &st, &ppid, &pg) != 3) continue;
    if (pg != pgid || st == 'Z') continue;
    t.procs++;
    std::ifstream sf("/proc/" + dname + "/status");
    std::string l;
    while (sf && std::getline(sf, l))
      if (l.rfind("VmRSS:", 0) == 0) { t.rss_kb += std::atoll(l.c_str() + 6); break; }
  }
  closedir(d);
  return t;
}

void child_setup_and_exec(const RunSpec& spec, const std::string& marker, int in_fd, int out_fd, int err_fd, int errpipe) {
  setsid();  // own session + process group: lets the parent kill the whole tree
  dup2(in_fd, 0);
  dup2(out_fd, 1);
  dup2(err_fd, 2);
  // Close everything else (CLOEXEC would also do, but be explicit and safe for inherited fds).
  long maxfd = sysconf(_SC_OPEN_MAX);
  if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
  for (int fd = 3; fd < maxfd; fd++)
    if (fd != errpipe) close(fd);

  auto lim = [](int res, rlim_t v) {
    struct rlimit r{v, v};
    setrlimit(res, &r);
  };
  const RunLimits& L = spec.limits;
  struct rlimit nocore{0, 0};
  setrlimit(RLIMIT_CORE, &nocore);
  lim(RLIMIT_FSIZE, static_cast<rlim_t>(L.file_size_kb) * 1024);
  lim(RLIMIT_NOFILE, static_cast<rlim_t>(L.max_open_files));
  if (L.cpu_ms > 0) {
    rlim_t secs = static_cast<rlim_t>((L.cpu_ms + 999) / 1000 + 1);
    struct rlimit r{secs, secs + 1};  // soft SIGXCPU then hard SIGKILL
    setrlimit(RLIMIT_CPU, &r);
  }
  if (L.address_space_kb > 0) lim(RLIMIT_AS, static_cast<rlim_t>(L.address_space_kb) * 1024);
  if (L.max_processes > 0) lim(RLIMIT_NPROC, static_cast<rlim_t>(L.max_processes));

  if (!spec.cwd.empty() && chdir(spec.cwd.c_str()) != 0) {
    int e = errno;
    ssize_t w = write(errpipe, &e, sizeof e);
    (void)w;
    _exit(127);
  }

  std::vector<char*> argv;
  for (auto& a : spec.argv) argv.push_back(const_cast<char*>(a.c_str()));
  argv.push_back(nullptr);
  std::vector<char*> envp;
  for (auto& e : spec.env) envp.push_back(const_cast<char*>(e.c_str()));
  envp.push_back(const_cast<char*>(marker.c_str()));
  envp.push_back(nullptr);

  // execvpe honours PATH from the *current* environ, so set it from the child env first.
  for (auto& e : spec.env)
    if (e.rfind("PATH=", 0) == 0) setenv("PATH", e.c_str() + 5, 1);
  execvpe(argv[0], argv.data(), envp.data());
  int e = errno;
  ssize_t w = write(errpipe, &e, sizeof e);
  (void)w;
  _exit(127);
}

}  // namespace

// Kill every process whose environment carries `marker` (catches setsid() escapees,
// which a process-group kill misses). Own-uid /proc/<pid>/environ is readable.
static void kill_marked(const std::string& marker) {
  DIR* d = opendir("/proc");
  if (!d) return;
  pid_t self = getpid();
  while (dirent* e = readdir(d)) {
    if (e->d_name[0] < '1' || e->d_name[0] > '9') continue;
    pid_t p = static_cast<pid_t>(atoi(e->d_name));
    if (p == self) continue;
    std::ifstream f("/proc/" + std::string(e->d_name) + "/environ", std::ios::binary);
    if (!f) continue;
    std::string env((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    size_t pos = 0;
    while (pos < env.size()) {
      size_t nul = env.find('\0', pos);
      if (nul == std::string::npos) nul = env.size();
      if (env.compare(pos, nul - pos, marker) == 0) { kill(p, SIGKILL); break; }
      pos = nul + 1;
    }
  }
  closedir(d);
}

void kill_group(int pgid) {
  if (pgid > 1) kill(-pgid, SIGKILL);
}

// Total number of kernel scheduling entities right now (4th field of /proc/loadavg).
static long total_tasks() {
  std::ifstream f("/proc/loadavg");
  std::string a, b, c, d;
  if (!(f >> a >> b >> c >> d)) return 0;
  size_t slash = d.find('/');
  return slash == std::string::npos ? 0 : atol(d.c_str() + slash + 1);
}

RunOutcome run_sandboxed(const RunSpec& spec_in) {
  // RLIMIT_NPROC is per-uid, so use headroom above what exists now. This is the hard
  // backstop against fork bombs: the polling monitor alone cannot outrun exponential growth.
  RunSpec spec = spec_in;
  if (spec.limits.max_processes == 0) {
    long t = total_tasks();
    if (t > 0) spec.limits.max_processes = static_cast<int>(t + 512);
  }
  static const bool sigpipe_ignored = [] { signal(SIGPIPE, SIG_IGN); return true; }();
  (void)sigpipe_ignored;

  static std::atomic<unsigned long> run_counter{0};
  const std::string marker = "AETHER_SANDBOX_RUN=" + std::to_string(getpid()) + "-" + std::to_string(run_counter.fetch_add(1));
  RunOutcome out;
  if (spec.argv.empty()) { out.spawn_failed = true; out.error = "empty argv"; return out; }

  int in_p[2], out_p[2], err_p[2], ctl_p[2];
  if (pipe2(in_p, O_CLOEXEC) || pipe2(out_p, O_CLOEXEC) || pipe2(err_p, O_CLOEXEC) || pipe2(ctl_p, O_CLOEXEC)) {
    out.spawn_failed = true;
    out.error = std::string("pipe: ") + std::strerror(errno);
    return out;
  }

  auto start = Clock::now();
  pid_t pid = fork();
  if (pid < 0) {
    out.spawn_failed = true;
    out.error = std::string("fork: ") + std::strerror(errno);
    for (int fd : {in_p[0], in_p[1], out_p[0], out_p[1], err_p[0], err_p[1], ctl_p[0], ctl_p[1]}) close(fd);
    return out;
  }
  if (pid == 0) {
    close(in_p[1]); close(out_p[0]); close(err_p[0]); close(ctl_p[0]);
    child_setup_and_exec(spec, marker, in_p[0], out_p[1], err_p[1], ctl_p[1]);
    _exit(127);
  }
  close(in_p[0]); close(out_p[1]); close(err_p[1]); close(ctl_p[1]);

  // exec status: pipe closes on successful exec (CLOEXEC); otherwise child sends errno.
  {
    int e = 0;
    ssize_t n;
    do { n = read(ctl_p[0], &e, sizeof e); } while (n < 0 && errno == EINTR);
    close(ctl_p[0]);
    if (n == static_cast<ssize_t>(sizeof e)) {
      int status;
      waitpid(pid, &status, 0);
      close(in_p[1]); close(out_p[0]); close(err_p[0]);
      out.spawn_failed = true;
      out.error = spec.argv[0] + ": " + std::strerror(e);
      return out;
    }
  }
  start = Clock::now();

  set_nonblock(in_p[1]); set_nonblock(out_p[0]); set_nonblock(err_p[0]);
  const RunLimits& L = spec.limits;
  size_t in_off = 0;
  int in_fd = in_p[1], out_fd = out_p[0], err_fd = err_p[0];
  if (spec.stdin_data.empty()) { close(in_fd); in_fd = -1; }

  int status = 0;
  struct rusage ru{};
  bool exited = false;
  long long peak = 0;
  long long next_mem_check = 0, next_scan = 0;
  char buf[65536];

  auto kill_tree = [&] { kill(-pid, SIGKILL); kill(pid, SIGKILL); };
  auto read_stream = [&](int& fd, std::string& dst) {
    for (;;) {
      ssize_t n = read(fd, buf, sizeof buf);
      if (n > 0) {
        size_t room = L.output_limit > dst.size() ? L.output_limit - dst.size() : 0;
        dst.append(buf, std::min<size_t>(room, static_cast<size_t>(n)));
        if (static_cast<size_t>(n) > room) { out.output_exceeded = true; kill_tree(); }
      } else if (n == 0) { close(fd); fd = -1; return; }
      else if (errno == EINTR) continue;
      else if (errno == EAGAIN || errno == EWOULDBLOCK) return;
      else { close(fd); fd = -1; return; }
    }
  };

  while (!exited || out_fd >= 0 || err_fd >= 0) {
    struct pollfd fds[3];
    int nf = 0;
    if (out_fd >= 0) fds[nf++] = {out_fd, POLLIN, 0};
    if (err_fd >= 0) fds[nf++] = {err_fd, POLLIN, 0};
    if (in_fd >= 0) fds[nf++] = {in_fd, POLLOUT, 0};
    long long elapsed = ms_since(start);
    int timeout = 5;
    if (exited) timeout = 20;
    if (nf == 0) usleep(timeout * 1000);
    else poll(fds, nf, timeout);

    if (in_fd >= 0) {
      while (in_off < spec.stdin_data.size()) {
        ssize_t n = write(in_fd, spec.stdin_data.data() + in_off, spec.stdin_data.size() - in_off);
        if (n > 0) in_off += static_cast<size_t>(n);
        else if (n < 0 && errno == EINTR) continue;
        else break;  // EAGAIN or EPIPE
      }
      bool broken = false;
      if (in_off < spec.stdin_data.size()) {
        char probe = 0;
        ssize_t n = write(in_fd, &probe, 0);
        if (n < 0 && errno == EPIPE) broken = true;
      }
      if (in_off >= spec.stdin_data.size() || broken) { close(in_fd); in_fd = -1; }
    }
    if (out_fd >= 0) read_stream(out_fd, out.out);
    if (err_fd >= 0) read_stream(err_fd, out.err);

    if (!exited) {
      pid_t r = wait4(pid, &status, WNOHANG, &ru);
      if (r == pid) {
        exited = true;
        // Anything the program left running in its group dies with it; this also closes
        // pipe write-ends held by orphans so we can drain and return promptly.
        kill(-pid, SIGKILL);
      } else {
        elapsed = ms_since(start);
        if (elapsed >= L.wall_ms && !out.timed_out) { out.timed_out = true; kill_tree(); }
        if (elapsed >= next_mem_check) {
          next_mem_check = elapsed + 4;
          long long kb = read_hwm_kb(pid);
          if (elapsed >= next_scan) {  // whole-group scan is pricier: every ~20ms
            next_scan = elapsed + 20;
            TreeStat ts = scan_group(pid);
            kb = std::max(kb, ts.rss_kb);
            if (L.max_group_procs > 0 && ts.procs > L.max_group_procs && !out.process_limit_exceeded) {
              out.process_limit_exceeded = true;
              kill_tree();
            }
          }
          peak = std::max(peak, kb);
          if (L.memory_kb > 0 && kb > L.memory_kb && !out.memory_exceeded) { out.memory_exceeded = true; kill_tree(); }
        }
      }
    } else {
      // Drain remaining output for a bounded grace period, then give up on stuck pipes.
      if (ms_since(start) > L.wall_ms + 500 || (out_fd < 0 && err_fd < 0)) break;
      static thread_local int spins;
      if (++spins > 50) { spins = 0; break; }
    }
  }
  if (out_fd >= 0) close(out_fd);
  if (err_fd >= 0) close(err_fd);
  if (in_fd >= 0) close(in_fd);
  if (!exited) {
    kill_tree();
    waitpid(pid, &status, 0);
    wait4(pid, &status, 0, &ru);
  }
  kill(-pid, SIGKILL);
  kill_marked(marker);

  out.wall_ms = ms_since(start);
  out.cpu_ms = ru.ru_utime.tv_sec * 1000LL + ru.ru_utime.tv_usec / 1000 + ru.ru_stime.tv_sec * 1000LL + ru.ru_stime.tv_usec / 1000;
  peak = std::max<long long>(peak, ru.ru_maxrss);  // Linux: kilobytes
  out.peak_rss_kb = peak;
  if (L.memory_kb > 0 && peak > L.memory_kb) out.memory_exceeded = true;
  if (WIFEXITED(status)) out.exit_code = WEXITSTATUS(status);
  else if (WIFSIGNALED(status)) { out.exit_code = -1; out.term_signal = WTERMSIG(status); }
  return out;
}

}  // namespace aether
