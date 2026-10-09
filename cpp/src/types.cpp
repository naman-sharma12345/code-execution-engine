#include "aether/types.hpp"

namespace aether {

const char* to_string(Language l) {
  switch (l) {
    case Language::JavaScript: return "javascript";
    case Language::Python: return "python";
    case Language::Cpp: return "cpp";
    case Language::Java: return "java";
  }
  return "?";
}
const char* to_string(Status s) {
  switch (s) {
    case Status::Pending: return "PENDING";
    case Status::Compiling: return "COMPILING";
    case Status::Running: return "RUNNING";
    case Status::Accepted: return "ACCEPTED";
    case Status::WrongAnswer: return "WRONG_ANSWER";
    case Status::TimeLimit: return "TLE";
    case Status::MemoryLimit: return "MLE";
    case Status::RuntimeError: return "RTE";
    case Status::Failed: return "FAILED";
  }
  return "?";
}
const char* to_string(CaseStatus s) {
  switch (s) {
    case CaseStatus::Accepted: return "ACCEPTED";
    case CaseStatus::WrongAnswer: return "WRONG_ANSWER";
    case CaseStatus::TimeLimit: return "TLE";
    case CaseStatus::MemoryLimit: return "MLE";
    case CaseStatus::RuntimeError: return "RTE";
    case CaseStatus::Skipped: return "SKIPPED";
  }
  return "?";
}
const char* to_string(Tier t) { return t == Tier::Premium ? "PREMIUM" : "FREE"; }

bool parse_language(const std::string& s, Language& out) {
  if (s == "javascript") out = Language::JavaScript;
  else if (s == "python") out = Language::Python;
  else if (s == "cpp") out = Language::Cpp;
  else if (s == "java") out = Language::Java;
  else return false;
  return true;
}
const char* language_label(Language l) {
  switch (l) {
    case Language::JavaScript: return "JavaScript (Node.js)";
    case Language::Python: return "Python 3";
    case Language::Cpp: return "C++ 17 (g++)";
    case Language::Java: return "Java 21 (OpenJDK)";
  }
  return "?";
}

}  // namespace aether
