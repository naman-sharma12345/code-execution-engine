// Domain types shared across the engine (mirrors src/domain/*.ts of the TS version).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace aether {

enum class Language { JavaScript, Python, Cpp, Java };

enum class Status {
  Pending, Compiling, Running, Accepted, WrongAnswer, TimeLimit, MemoryLimit, RuntimeError, Failed
};
enum class CaseStatus { Accepted, WrongAnswer, TimeLimit, MemoryLimit, RuntimeError, Skipped };
enum class Tier { Free, Premium };

const char* to_string(Language);
const char* to_string(Status);
const char* to_string(CaseStatus);
const char* to_string(Tier);
bool parse_language(const std::string& s, Language& out);
const char* language_label(Language);
inline bool is_terminal(Status s) { return s != Status::Pending && s != Status::Compiling && s != Status::Running; }

struct TestCase {
  std::string id;
  std::string input;
  std::string expected;
  bool hidden = false;
  int order = 0;
};

struct Problem {
  std::string id, title, description, difficulty, tags;
  int time_limit_ms = 2000;
  int cpu_time_limit_ms = 2000;
  int memory_limit_mb = 256;
  std::vector<TestCase> tests;
};

struct CaseResult {
  std::string test_case_id;
  CaseStatus status = CaseStatus::Skipped;
  std::string stdout_text, stderr_text;
  int exit_code = 0;
  long long time_ms = 0;
  long long memory_kb = 0;
};

struct Verdict {
  Status status = Status::Failed;
  long long time_ms = 0;
  long long memory_kb = 0;
  int passed = 0;
  int total = 0;
  std::string error_message;
  std::string compile_output;
  std::vector<CaseResult> cases;
  bool infra_error = false;  // judge could not do its job (not the submission's fault): retry-worthy
};

}  // namespace aether
