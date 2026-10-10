#include "aether/languages.hpp"

#include <unistd.h>

#include <cstdlib>
#include <fstream>

namespace aether {

std::vector<std::string> LanguageRunner::base_env(const std::string& work_dir) {
  const char* path = std::getenv("PATH");
  return {std::string("PATH=") + (path ? path : "/usr/local/bin:/usr/bin:/bin"),
          "HOME=" + work_dir, "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TMPDIR=" + work_dir};
}

CompileResult LanguageRunner::compile(const std::string&) const { return {true, ""}; }

CompileResult LanguageRunner::run_compiler(const std::string& work_dir, std::vector<std::string> argv) const {
  RunSpec s;
  s.argv = std::move(argv);
  s.cwd = work_dir;
  s.env = base_env(work_dir);
  s.limits.wall_ms = 15000;
  s.limits.memory_kb = 1024 * 1024;
  s.limits.output_limit = 64 * 1024;
  s.limits.file_size_kb = 64 * 1024;
  s.limits.max_open_files = 256;
  RunOutcome o = run_sandboxed(s);
  CompileResult r;
  if (o.spawn_failed) { r.output = "compiler unavailable: " + o.error; r.unavailable = true; return r; }
  r.output = o.err.empty() ? o.out : (o.out.empty() ? o.err : o.out + o.err);
  if (o.timed_out) { r.output += "\ncompilation timed out"; return r; }
  r.success = (o.exit_code == 0);
  return r;
}

namespace {

bool in_path(const char* exe) {
  const char* path = std::getenv("PATH");
  std::string p = path ? path : "/usr/local/bin:/usr/bin:/bin";
  size_t i = 0;
  while (i <= p.size()) {
    size_t e = p.find(':', i);
    std::string dir = p.substr(i, e == std::string::npos ? std::string::npos : e - i);
    if (!dir.empty() && access((dir + "/" + exe).c_str(), X_OK) == 0) return true;
    if (e == std::string::npos) break;
    i = e + 1;
  }
  return false;
}

long long as_limit(const Problem& p, int factor) {
  return static_cast<long long>(p.memory_limit_mb) * 1024 * factor + 256 * 1024;
}

RunSpec common(const std::string& dir, const Problem& p, const std::string& in) {
  RunSpec s;
  s.cwd = dir;
  s.env = {};
  s.stdin_data = in;
  s.limits.wall_ms = p.time_limit_ms;
  s.limits.cpu_ms = p.cpu_time_limit_ms;
  s.limits.memory_kb = static_cast<long long>(p.memory_limit_mb) * 1024;
  return s;
}

class CppRunner : public LanguageRunner {
 public:
  Language language() const override { return Language::Cpp; }
  const char* source_file() const override { return "Main.cpp"; }
  bool requires_compile() const override { return true; }
  CompileResult compile(const std::string& d) const override {
    return run_compiler(d, {"g++", "-std=c++17", "-O2", "-w", "-o", d + "/Main", d + "/Main.cpp"});
  }
  RunSpec make_run(const std::string& d, const Problem& p, const std::string& in) const override {
    RunSpec s = common(d, p, in);
    s.argv = {d + "/Main"};
    s.env = base_env(d);
    s.limits.address_space_kb = as_limit(p, 4);
    return s;
  }
};

class PythonRunner : public LanguageRunner {
 public:
  Language language() const override { return Language::Python; }
  const char* source_file() const override { return "Main.py"; }
  bool requires_compile() const override { return false; }
  RunSpec make_run(const std::string& d, const Problem& p, const std::string& in) const override {
    RunSpec s = common(d, p, in);
    s.argv = {"python3", "-B", "-I", d + "/Main.py"};
    s.env = base_env(d);
    s.env.push_back("PYTHONIOENCODING=utf-8");
    s.env.push_back("PYTHONDONTWRITEBYTECODE=1");
    s.limits.address_space_kb = as_limit(p, 4);
    return s;
  }
};

class NodeRunner : public LanguageRunner {
 public:
  Language language() const override { return Language::JavaScript; }
  const char* source_file() const override { return "Main.js"; }
  bool requires_compile() const override { return false; }
  RunSpec make_run(const std::string& d, const Problem& p, const std::string& in) const override {
    RunSpec s = common(d, p, in);
    int heap = std::max(64, p.memory_limit_mb - 16);
    s.argv = {"node", "--max-old-space-size=" + std::to_string(heap), "--no-warnings", d + "/Main.js"};
    s.env = base_env(d);
    return s;  // V8 reserves huge virtual ranges: no RLIMIT_AS, RSS is monitored instead
  }
};

class JavaRunner : public LanguageRunner {
 public:
  Language language() const override { return Language::Java; }
  const char* source_file() const override { return "Main.java"; }
  bool requires_compile() const override { return true; }
  CompileResult compile(const std::string& d) const override {
    // JRE-only hosts still ship the compiler module; fall back to it when javac is not installed.
    if (in_path("javac")) return run_compiler(d, {"javac", "-J-Xmx512m", "-d", d, d + "/Main.java"});
    return run_compiler(d, {"java", "-Xmx512m", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-d", d, d + "/Main.java"});
  }
  RunSpec make_run(const std::string& d, const Problem& p, const std::string& in) const override {
    RunSpec s = common(d, p, in);
    int heap = std::max(64, p.memory_limit_mb - 32);
    s.argv = {"java", "-Xmx" + std::to_string(heap) + "m", "-Xss64m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1",
              "-Xshare:auto", "-cp", d, "Main"};
    s.env = base_env(d);
    s.limits.max_open_files = 256;
    return s;
  }
};

}  // namespace

const LanguageRunner& get_runner(Language l) {
  static const CppRunner cpp;
  static const PythonRunner py;
  static const NodeRunner js;
  static const JavaRunner java;
  switch (l) {
    case Language::Cpp: return cpp;
    case Language::Python: return py;
    case Language::JavaScript: return js;
    case Language::Java: return java;
  }
  return cpp;
}

bool write_source(const LanguageRunner& r, const std::string& dir, const std::string& code) {
  std::ofstream f(dir + "/" + r.source_file(), std::ios::binary | std::ios::trunc);
  if (!f) return false;
  f.write(code.data(), static_cast<std::streamsize>(code.size()));
  return static_cast<bool>(f);
}

}  // namespace aether
