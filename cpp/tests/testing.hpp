// Tiny dependency-free test framework.
#pragma once
#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace t {
struct Case { std::string name; std::function<void()> fn; };
inline std::vector<Case>& registry() { static std::vector<Case> r; return r; }
inline int& failures() { static int f = 0; return f; }
struct Reg { Reg(const char* n, std::function<void()> f) { registry().push_back({n, std::move(f)}); } };
}  // namespace t

#define TEST(name) static void name(); static t::Reg reg_##name(#name, name); static void name()
#define CHECK(cond) do { if (!(cond)) { t::failures()++; std::cerr << "  FAIL " << __FILE__ << ":" << __LINE__ << ": " #cond "\n"; } } while (0)
#define CHECK_EQ(a, b) do { auto _a = (a); auto _b = (b); if (!(_a == _b)) { t::failures()++; std::ostringstream _o; _o << "  FAIL " << __FILE__ << ":" << __LINE__ << ": " #a " == " #b "  (" << _a << " vs " << _b << ")\n"; std::cerr << _o.str(); } } while (0)
