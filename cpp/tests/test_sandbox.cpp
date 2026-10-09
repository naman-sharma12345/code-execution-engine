#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <chrono>
#include <fstream>

#include "aether/judge.hpp"
#include "aether/sandbox.hpp"
#include "testing.hpp"

using namespace aether;

static RunSpec sh(const std::string& script, long long wall = 2000) {
  RunSpec s;
  s.argv = {"/bin/sh", "-c", script};
  s.env = {"PATH=/usr/bin:/bin"};
  s.cwd = "/tmp";
  s.limits.wall_ms = wall;
  return s;
}

TEST(sandbox_echo_and_exit_code) {
  auto s = sh("cat; echo err 1>&2; exit 3");
  s.stdin_data = "hello";
  auto o = run_sandboxed(s);
  CHECK_EQ(o.out, std::string("hello"));
  CHECK_EQ(o.err, std::string("err\n"));
  CHECK_EQ(o.exit_code, 3);
  CHECK(!o.timed_out);
}
TEST(sandbox_wall_timeout_kills_process) {
  auto o = run_sandboxed(sh("while :; do :; done", 300));
  CHECK(o.timed_out);
  CHECK(o.wall_ms >= 300 && o.wall_ms < 1500);
  CHECK_EQ(o.term_signal, SIGKILL);
}
TEST(sandbox_timeout_kills_whole_process_group) {
  std::string marker = "/tmp/aether_orphan_" + std::to_string(getpid());
  unlink(marker.c_str());
  auto o = run_sandboxed(sh("(sleep 1; echo alive > " + marker + ") & sleep 30", 200));
  CHECK(o.timed_out);
  usleep(1500 * 1000);
  CHECK(access(marker.c_str(), F_OK) != 0);  // grandchild must have been killed
  unlink(marker.c_str());
}
TEST(sandbox_orphan_holding_pipe_does_not_hang) {
  auto start = std::chrono::steady_clock::now();
  auto o = run_sandboxed(sh("(sleep 20) & echo done; exit 0", 3000));
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
  CHECK_EQ(o.out, std::string("done\n"));
  CHECK(ms < 1500);
}
TEST(sandbox_output_limit) {
  auto s = sh("yes");
  s.limits.output_limit = 1000;
  auto o = run_sandboxed(s);
  CHECK(o.output_exceeded);
  CHECK(o.out.size() <= 1000);
}
TEST(sandbox_large_stdin_no_deadlock_when_child_ignores_input) {
  auto s = sh("echo ok");
  s.stdin_data.assign(8 << 20, 'x');
  auto o = run_sandboxed(s);
  CHECK_EQ(o.out, std::string("ok\n"));
  CHECK(o.wall_ms < 1500);
}
TEST(sandbox_large_stdin_echoed_fully) {
  auto s = sh("cat", 5000);
  s.stdin_data.assign(3 << 20, 'y');
  s.limits.output_limit = 8 << 20;
  auto o = run_sandboxed(s);
  CHECK_EQ(o.out.size(), s.stdin_data.size());
}
TEST(sandbox_spawn_failure_reported) {
  RunSpec s;
  s.argv = {"/definitely/not/here"};
  s.env = {"PATH=/usr/bin"};
  auto o = run_sandboxed(s);
  CHECK(o.spawn_failed);
  CHECK(!o.error.empty());
  RunSpec b = sh("true");
  b.cwd = "/no/such/dir";
  CHECK(run_sandboxed(b).spawn_failed);
}
TEST(sandbox_signal_death_reported) {
  auto o = run_sandboxed(sh("kill -SEGV $$"));
  CHECK_EQ(o.term_signal, SIGSEGV);
  CHECK_EQ(o.exit_code, -1);
}
TEST(sandbox_memory_limit_kills_and_flags) {
  auto s = sh("python3 -c \"x = bytearray(400*1024*1024); import time; time.sleep(5)\"", 5000);
  s.limits.memory_kb = 100 * 1024;
  auto o = run_sandboxed(s);
  CHECK(o.memory_exceeded);
  CHECK(o.wall_ms < 3000);
}
TEST(sandbox_does_not_leak_parent_env_or_fds) {
  setenv("AETHER_SECRET", "topsecret", 1);
  // Park a descriptor at a high number so it cannot collide with the low fd that `ls`
  // opens for its own directory listing.
  int base = open("/etc/hostname", O_RDONLY);
  int fd = 200;
  CHECK(dup2(base, fd) == fd);
  close(base);
  auto o = run_sandboxed(sh("env; echo FDS; ls /proc/self/fd | tr '\\n' ' '"));
  CHECK(o.out.find("topsecret") == std::string::npos);
  CHECK(o.out.find("AETHER_SECRET") == std::string::npos);
  auto pos = o.out.find("FDS");
  CHECK(pos != std::string::npos);
  std::string fds = o.out.substr(pos);
  CHECK(fds.find(" 200 ") == std::string::npos && fds.find("\n200 ") == std::string::npos);
  close(fd);
}
TEST(sandbox_rlimit_fsize_blocks_big_files) {
  auto s = sh("head -c 5000000 /dev/zero > /tmp/aether_fsize_test; echo rc=$?; rm -f /tmp/aether_fsize_test");
  s.limits.file_size_kb = 100;
  auto o = run_sandboxed(s);
  CHECK(o.out.find("rc=0") == std::string::npos);
}
TEST(sandbox_cpu_limit_backstop) {
  auto s = sh("while :; do :; done", 20000);
  s.limits.cpu_ms = 500;
  auto o = run_sandboxed(s);
  CHECK(o.wall_ms < 5000);
  CHECK(o.term_signal != 0);
}
TEST(sandbox_reports_peak_memory_and_cpu) {
  auto o = run_sandboxed(sh("python3 -c \"x = bytearray(60*1024*1024); sum(range(2000000))\"", 5000));
  CHECK(o.peak_rss_kb > 50 * 1024);
  CHECK(o.cpu_ms > 0);
}
TEST(sandbox_fork_bomb_is_contained) {
  auto s = sh("while :; do sleep 100 & done", 4000);
  s.limits.max_group_procs = 40;
  auto o = run_sandboxed(s);
  CHECK(o.process_limit_exceeded || o.timed_out);
  usleep(300 * 1000);
  // nothing from that group may survive
  FILE* p = popen("pgrep -f '[s]leep 100' | wc -l", "r");
  int n = -1; if (p) { if (fscanf(p, "%d", &n) != 1) n = -1; pclose(p); }
  CHECK(n <= 0);
}
TEST(sandbox_setsid_escapee_does_not_hang_and_is_reaped) {
  auto start = std::chrono::steady_clock::now();
  auto o = run_sandboxed(sh("setsid sleep 7.31 >/dev/null 2>&1 & echo ok; sleep 0.2", 3000));
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
  CHECK_EQ(o.out, std::string("ok\n"));
  CHECK(ms < 2000);
  // the escapee must not survive the run
  usleep(300 * 1000);
  int alive = std::system("pgrep -f '[s]leep 7.31' >/dev/null 2>&1");
  CHECK(alive != 0);
  std::system("pkill -f '[s]leep 7.31' >/dev/null 2>&1");
}
TEST(sandbox_stderr_flood_is_capped) {
  auto s = sh("yes >&2");
  s.limits.output_limit = 2000;
  auto o = run_sandboxed(s);
  CHECK(o.output_exceeded);
  CHECK(o.err.size() <= 2000);
}
TEST(sandbox_closed_stdout_and_stdin_ok) {
  auto o = run_sandboxed(sh("exec >&-; exec <&-; exit 3"));
  CHECK_EQ(o.exit_code, 3);
}
TEST(sandbox_python_fork_loop_is_contained) {
  RunSpec s;
  s.argv = {"python3", "-c", "import os\nwhile True: os.fork()"};
  s.env = {"PATH=/usr/bin:/bin"};
  s.limits.wall_ms = 3000;
  auto start = std::chrono::steady_clock::now();
  auto o = run_sandboxed(s);
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
  // Generous: shared CI runners are slow at tearing down hundreds of processes.
  CHECK(ms < 20000);
  CHECK(o.process_limit_exceeded || o.timed_out || o.exit_code != 0);
  usleep(500 * 1000);
  CHECK_EQ(std::system("true"), 0);
}
