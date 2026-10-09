#include <chrono>
#include <cstring>
#include "testing.hpp"
int main(int argc, char** argv) {
  const char* filter = argc > 1 ? argv[1] : nullptr;
  int ran = 0, bad = 0;
  for (auto& c : t::registry()) {
    if (filter && c.name.find(filter) == std::string::npos) continue;
    int before = t::failures();
    auto st = std::chrono::steady_clock::now();
    try { c.fn(); } catch (const std::exception& e) { t::failures()++; std::cerr << "  EXCEPTION " << e.what() << "\n"; }
    long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - st).count();
    bool ok = t::failures() == before;
    std::cout << (ok ? "[ PASS ] " : "[ FAIL ] ") << c.name << " (" << ms << " ms)\n";
    ran++; if (!ok) bad++;
  }
  std::cout << "\n" << (ran - bad) << "/" << ran << " tests passed\n";
  return bad ? 1 : 0;
}
