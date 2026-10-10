// Pluggable output checkers (Strategy pattern).
#pragma once
#include <string>

namespace aether {

struct CheckResult {
  bool accepted = false;
  std::string reason;
};

class Checker {
 public:
  virtual ~Checker() = default;
  virtual CheckResult check(const std::string& expected, const std::string& actual) const = 0;
};

// Token-insensitive to trailing whitespace per line, CRLF, and trailing/leading blank lines.
class ExactChecker : public Checker {
 public:
  CheckResult check(const std::string& expected, const std::string& actual) const override;
  static std::string normalize(const std::string& s);
};

// Whitespace-separated numbers compared with abs OR rel tolerance.
class ToleranceChecker : public Checker {
 public:
  explicit ToleranceChecker(double tol = 1e-6) : tol_(tol) {}
  CheckResult check(const std::string& expected, const std::string& actual) const override;

 private:
  double tol_;
};

// Returns a shared checker by name ("exact" | "tolerance"); unknown names fall back to exact.
const Checker& get_checker(const std::string& name);

}  // namespace aether
