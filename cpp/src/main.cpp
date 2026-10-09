// aetherrun: C++17 code execution engine. Configuration via environment:
//   AETHER_PORT (3001)  AETHER_HOST (127.0.0.1)  AETHER_WORKERS (2)  AETHER_PROBLEMS (data/problems.json)
#include <signal.h>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>

#include "aether/engine.hpp"
#include "aether/server.hpp"

using namespace aether;

static volatile sig_atomic_t g_stop = 0;
static void on_signal(int) { g_stop = 1; }

static long env_int(const char* k, long d, long lo, long hi) {
  const char* v = std::getenv(k);
  if (!v || !*v) return d;
  char* end = nullptr;
  long x = std::strtol(v, &end, 10);
  if (*end != '\0' || x < lo || x > hi) { std::cerr << "invalid " << k << "=" << v << "\n"; std::exit(2); }
  return x;
}

int main() {
  EngineConfig ec;
  ec.workers = static_cast<int>(env_int("AETHER_WORKERS", 2, 1, 64));
  Engine engine(ec);
  const char* pf = std::getenv("AETHER_PROBLEMS");
  std::string path = pf ? pf : "data/problems.json";
  std::ifstream f(path);
  if (!f) { std::cerr << "cannot read problems file: " << path << "\n"; return 2; }
  std::stringstream ss; ss << f.rdbuf();
  try { engine.load_problems_json(ss.str()); } catch (const std::exception& e) { std::cerr << "bad problems file: " << e.what() << "\n"; return 2; }
  engine.add_user({"user_free", "demo_free", "demo_free@aether.run", Tier::Free});
  engine.add_user({"user_pro", "demo_pro", "demo_pro@aether.run", Tier::Premium});
  engine.start();

  ServerConfig sc;
  sc.port = static_cast<int>(env_int("AETHER_PORT", 3001, 0, 65535));
  if (const char* h = std::getenv("AETHER_HOST")) sc.host = h;
  Server server(engine, sc);
  std::string err;
  if (!server.start(err)) { std::cerr << "server: " << err << "\n"; return 1; }
  struct sigaction sa{};
  sa.sa_handler = on_signal;
  sigaction(SIGINT, &sa, nullptr);
  sigaction(SIGTERM, &sa, nullptr);
  std::cout << "AetherRun (C++) listening on http://" << sc.host << ":" << server.port() << "  workers=" << ec.workers << std::endl;
  while (!g_stop) { struct timespec ts{0, 100 * 1000 * 1000}; nanosleep(&ts, nullptr); }
  std::cout << "shutting down" << std::endl;
  server.stop();
  engine.stop();
  return 0;
}
