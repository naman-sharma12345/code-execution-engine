#include "aether/checker.hpp"

#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <sstream>
#include <vector>

namespace aether {

std::string ExactChecker::normalize(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  size_t i = 0;
  while (i <= in.size()) {
    size_t nl = in.find('\n', i);
    std::string line = in.substr(i, nl == std::string::npos ? std::string::npos : nl - i);
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t' ||
                             line.back() == '\f' || line.back() == '\v'))
      line.pop_back();
    out += line;
    if (nl == std::string::npos) break;
    out += '\n';
    i = nl + 1;
  }
  // Strip leading blank lines and all trailing newlines: "8", "8\n" and "8\n\n" are equal.
  size_t b = 0;
  while (b < out.size() && out[b] == '\n') b++;
  size_t e = out.size();
  while (e > b && out[e - 1] == '\n') e--;
  return out.substr(b, e - b);
}

static std::string clip(const std::string& s) {
  std::string c = s.substr(0, 80);
  std::string r;
  for (char ch : c) r += ch == '\n' ? std::string("\\n") : std::string(1, ch);
  return r + (s.size() > 80 ? "..." : "");
}

CheckResult ExactChecker::check(const std::string& expected, const std::string& actual) const {
  std::string e = normalize(expected), a = normalize(actual);
  if (e == a) return {true, ""};
  return {false, "Expected \"" + clip(e) + "\", got \"" + clip(a) + "\""};
}

static bool tokens(const std::string& s, std::vector<double>& out, size_t& bad) {
  std::istringstream is(s);
  std::string t;
  size_t idx = 0;
  while (is >> t) {
    char* end = nullptr;
    errno = 0;
    double d = std::strtod(t.c_str(), &end);
    if (end == t.c_str() || *end != '\0' || std::isnan(d)) { bad = idx; return false; }
    out.push_back(d);
    idx++;
  }
  return true;
}

CheckResult ToleranceChecker::check(const std::string& expected, const std::string& actual) const {
  std::vector<double> e, a;
  size_t bad = 0;
  if (!tokens(expected, e, bad)) return {false, "Expected output is not numeric at position " + std::to_string(bad)};
  if (!tokens(actual, a, bad)) return {false, "Output is not a number at position " + std::to_string(bad)};
  if (e.size() != a.size())
    return {false, "Expected " + std::to_string(e.size()) + " numbers, got " + std::to_string(a.size())};
  for (size_t i = 0; i < e.size(); i++) {
    if (std::isinf(e[i]) || std::isinf(a[i])) {
      if (e[i] != a[i]) return {false, "Infinity mismatch at position " + std::to_string(i)};
      continue;
    }
    double diff = std::fabs(e[i] - a[i]);
    double scale = std::max(1.0, std::fabs(e[i]));
    if (diff > tol_ * scale)
      return {false, "Difference exceeds tolerance at position " + std::to_string(i)};
  }
  return {true, ""};
}

const Checker& get_checker(const std::string& name) {
  static const ExactChecker exact;
  static const ToleranceChecker tol(1e-6);
  return name == "tolerance" ? static_cast<const Checker&>(tol) : static_cast<const Checker&>(exact);
}

}  // namespace aether
