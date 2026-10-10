// Judge: compile once, run every test case, produce a Verdict. Pure function of its inputs
// (no global state), so it is trivially testable and thread-safe.
#pragma once
#include <functional>
#include <string>

#include "aether/types.hpp"

namespace aether {

struct JudgeEvent {
  enum Type { StatusChange, Compile, Log, Case } type;
  Status status = Status::Pending;
  std::string message;
  CaseResult result;
};
using JudgeSink = std::function<void(const JudgeEvent&)>;

Verdict judge(const Problem& problem, Language lang, const std::string& code, const JudgeSink& sink = nullptr);

// Maps a raw run outcome to a per-test verdict. Exposed for unit tests.
struct RunOutcome;
CaseStatus classify(const RunOutcome& o, bool output_matches);

}  // namespace aether
