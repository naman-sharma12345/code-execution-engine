#include "aether/judge.hpp"

#include <stdlib.h>
#include <unistd.h>

#include <algorithm>
#include <cstring>
#include <filesystem>

#include "aether/checker.hpp"
#include "aether/languages.hpp"
#include "aether/sandbox.hpp"

namespace aether {
namespace {

struct WorkDir {
  std::string path;
  WorkDir() {
    std::string tmpl = (std::filesystem::temp_directory_path() / "aether-XXXXXX").string();
    std::vector<char> b(tmpl.begin(), tmpl.end());
    b.push_back('\0');
    if (mkdtemp(b.data())) path = b.data();
  }
  ~WorkDir() {
    if (!path.empty()) {
      std::error_code ec;
      std::filesystem::remove_all(path, ec);
    }
  }
};

int severity(CaseStatus s) {
  switch (s) {
    case CaseStatus::Accepted: return 0;
    case CaseStatus::Skipped: return 1;
    case CaseStatus::WrongAnswer: return 2;
    case CaseStatus::RuntimeError: return 3;
    case CaseStatus::TimeLimit: return 4;
    case CaseStatus::MemoryLimit: return 5;
  }
  return 0;
}

}  // namespace

CaseStatus classify(const RunOutcome& o, bool output_matches) {
  if (o.timed_out) return CaseStatus::TimeLimit;
  if (o.memory_exceeded) return CaseStatus::MemoryLimit;
  if (o.output_exceeded || o.process_limit_exceeded) return CaseStatus::RuntimeError;
  if (o.term_signal != 0 || o.exit_code != 0) return CaseStatus::RuntimeError;
  return output_matches ? CaseStatus::Accepted : CaseStatus::WrongAnswer;
}

Verdict judge(const Problem& problem, Language lang, const std::string& code, const JudgeSink& sink) {
  auto emit = [&](JudgeEvent e) { if (sink) sink(e); };
  Verdict v;
  v.total = static_cast<int>(problem.tests.size());

  if (problem.tests.empty()) {
    v.status = Status::Failed;
    v.error_message = "Problem has no test cases";
    v.infra_error = false;
    return v;
  }
  auto skipped = [&] {
    for (auto& t : problem.tests) { CaseResult c; c.test_case_id = t.id; c.status = CaseStatus::Skipped; v.cases.push_back(c); }
  };

  WorkDir wd;
  if (wd.path.empty()) { v.status = Status::Failed; v.error_message = "Could not create work directory"; v.infra_error = true; skipped(); return v; }
  const LanguageRunner& runner = get_runner(lang);
  if (!write_source(runner, wd.path, code)) {
    v.status = Status::Failed; v.error_message = "Could not write source file"; v.infra_error = true; skipped(); return v;
  }

  emit({JudgeEvent::StatusChange, Status::Compiling, std::string("Compiling ") + to_string(lang) + "...", {}});
  CompileResult cr = runner.compile(wd.path);
  if (!cr.success) {
    v.status = Status::Failed;
    v.error_message = "Compilation failed";
    v.compile_output = cr.output;
    v.infra_error = cr.unavailable;
    skipped();
    return v;
  }
  if (!cr.output.empty()) emit({JudgeEvent::Compile, Status::Compiling, cr.output, {}});

  emit({JudgeEvent::StatusChange, Status::Running, "Running test cases...", {}});
  const Checker& checker = get_checker("exact");
  bool hard_failure = false;
  CaseStatus first_hard = CaseStatus::Accepted;

  std::vector<TestCase> tests = problem.tests;
  std::stable_sort(tests.begin(), tests.end(), [](const TestCase& a, const TestCase& b) { return a.order < b.order; });
  v.total = static_cast<int>(tests.size());

  for (size_t i = 0; i < tests.size(); i++) {
    const TestCase& tc = tests[i];
    CaseResult cres;
    cres.test_case_id = tc.id;
    if (hard_failure) {
      cres.status = CaseStatus::Skipped;
      v.cases.push_back(cres);
      emit({JudgeEvent::Case, Status::Running, "", cres});
      continue;
    }
    emit({JudgeEvent::Log, Status::Running,
          "Test case " + std::to_string(i + 1) + "/" + std::to_string(tests.size()) + (tc.hidden ? " (hidden)" : ""), {}});
    RunSpec spec = runner.make_run(wd.path, problem, tc.input);
    RunOutcome o = run_sandboxed(spec);
    if (o.spawn_failed) {
      v.status = Status::Failed;
      v.error_message = "Could not start program: " + o.error;
      v.infra_error = true;
      // Preserve results gathered so far; the rest are skipped.
      for (size_t k = i; k < tests.size(); k++) { CaseResult c; c.test_case_id = tests[k].id; c.status = CaseStatus::Skipped; v.cases.push_back(c); }
      return v;
    }
    bool match = false;
    if (!o.timed_out && !o.memory_exceeded && !o.output_exceeded && !o.process_limit_exceeded && o.exit_code == 0 && o.term_signal == 0)
      match = checker.check(tc.expected, o.out).accepted;
    cres.status = classify(o, match);
    cres.stdout_text = o.out;
    cres.stderr_text = o.err;
    if (o.output_exceeded) cres.stderr_text += "\n[output limit exceeded]";
    if (o.process_limit_exceeded) cres.stderr_text += "\n[too many processes]";
    if (o.term_signal) cres.stderr_text += std::string("\n[terminated by signal ") + std::to_string(o.term_signal) + " (" + (strsignal(o.term_signal) ? strsignal(o.term_signal) : "?") + ")]";
    cres.exit_code = o.exit_code;
    cres.time_ms = o.wall_ms;
    cres.memory_kb = o.peak_rss_kb;
    v.time_ms = std::max(v.time_ms, cres.time_ms);
    v.memory_kb = std::max(v.memory_kb, cres.memory_kb);
    if (cres.status == CaseStatus::Accepted) v.passed++;
    v.cases.push_back(cres);
    emit({JudgeEvent::Case, Status::Running, "", cres});
    if (severity(cres.status) >= severity(CaseStatus::RuntimeError)) { hard_failure = true; first_hard = cres.status; }
  }

  if (hard_failure) {
    switch (first_hard) {
      case CaseStatus::TimeLimit: v.status = Status::TimeLimit; break;
      case CaseStatus::MemoryLimit: v.status = Status::MemoryLimit; break;
      default: v.status = Status::RuntimeError;
    }
  } else if (v.passed < v.total) v.status = Status::WrongAnswer;
  else v.status = Status::Accepted;
  return v;
}

}  // namespace aether
