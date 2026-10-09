#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <fstream>
#include <sstream>
#include <thread>

#include "aether/engine.hpp"
#include "aether/server.hpp"
#include "testing.hpp"

using namespace aether;

struct Reply { int status = 0; std::string head, body; };

static int connect_to(int port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(port); inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
  if (connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) { close(fd); return -1; }
  struct timeval tv{15, 0}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  return fd;
}
static Reply raw(int port, const std::string& req) {
  Reply r;
  int fd = connect_to(port);
  if (fd < 0) return r;
  send(fd, req.data(), req.size(), MSG_NOSIGNAL);
  std::string all; char b[8192]; ssize_t n;
  while ((n = recv(fd, b, sizeof b, 0)) > 0) all.append(b, n);
  close(fd);
  size_t he = all.find("\r\n\r\n");
  if (all.size() > 12) r.status = std::atoi(all.c_str() + 9);
  if (he != std::string::npos) { r.head = all.substr(0, he); r.body = all.substr(he + 4); }
  return r;
}
static Reply http(int port, const std::string& m, const std::string& path, const std::string& body = "") {
  std::string req = m + " " + path + " HTTP/1.1\r\nHost: x\r\n";
  if (m == "POST") req += "Content-Type: application/json\r\nContent-Length: " + std::to_string(body.size()) + "\r\n";
  return raw(port, req + "\r\n" + body);
}

struct Fixture {
  Engine engine;
  Server server;
  std::string err;
  static EngineConfig cfg(int rl) { EngineConfig c; c.workers = 2; c.rate_limit = rl; return c; }
  explicit Fixture(int rl = 100, ServerConfig sc = {}) : engine(cfg(rl)), server(engine, [&] { sc.port = 0; return sc; }()) {
    Problem p; p.id = "sum"; p.title = "A+B"; p.time_limit_ms = 3000; p.memory_limit_mb = 256;
    p.tests = {{"s0", "3 5\n", "8\n", false, 0}, {"s1", "1 2\n", "3\n", true, 1}};
    engine.add_problem(p);
    engine.add_user({"u1", "alice", "a@x", Tier::Free});
    engine.add_user({"u2", "bob", "b@x", Tier::Premium});
    engine.start();
    CHECK(server.start(err));
  }
};

static std::string submit_body(const std::string& code, const std::string& lang = "python", const std::string& = "") {
  Json j = Json::object(); j["problemId"] = "sum"; j["language"] = lang; j["code"] = code;
  return j.dump();
}
static Reply post_sub(int port, const std::string& body, const std::string& user = "u1") {
  return http(port, "POST", "/api/submissions?userId=" + user, body);
}
static const char* PY = "a,b=map(int,input().split())\nprint(a+b)\n";

TEST(http_basic_routes) {
  Fixture f;
  auto h = http(f.server.port(), "GET", "/health");
  CHECK_EQ(h.status, 200);
  CHECK(Json::parse(h.body).str_or("status") == "ok");
  auto pl = http(f.server.port(), "GET", "/api/problems");
  CHECK_EQ(pl.status, 200);
  CHECK_EQ(Json::parse(pl.body).find("problems")->as_array().size(), 1u);
  auto p = http(f.server.port(), "GET", "/api/problems/sum");
  Json pj = *Json::parse(p.body).find("problem");
  CHECK_EQ(pj.find("sampleTestCases")->as_array().size(), 1u);
  CHECK_EQ(pj.int_or("hiddenTestCases"), 1);
  CHECK(pj.find("tags")->is_array());  // hidden test never exposed
  CHECK(p.body.find("\"expectedOutput\":\"3") == std::string::npos);  // hidden expected output never exposed
  CHECK_EQ(http(f.server.port(), "GET", "/api/problems/nope").status, 404);
  CHECK_EQ(http(f.server.port(), "GET", "/nothing").status, 404);
  CHECK_EQ(http(f.server.port(), "DELETE", "/api/problems").status, 405);
  CHECK_EQ(http(f.server.port(), "GET", "/api/users").status, 200);
  CHECK_EQ(http(f.server.port(), "GET", "/api/stats").status, 200);
  CHECK_EQ(http(f.server.port(), "OPTIONS", "/api/submissions").status, 204);
}
TEST(http_submit_and_poll_to_accepted) {
  Fixture f;
  auto r = post_sub(f.server.port(), submit_body(PY));
  CHECK_EQ(r.status, 201);
  std::string id = Json::parse(r.body).str_or("submissionId");
  CHECK(f.engine.wait_done(id, 20000));
  auto g = http(f.server.port(), "GET", "/api/submissions/" + id);
  Json j = *Json::parse(g.body).find("submission");
  CHECK_EQ(j.str_or("status"), std::string("ACCEPTED"));
  CHECK_EQ(j.int_or("testCasesPassed"), 2);
  CHECK_EQ(j.find("problem")->str_or("title"), std::string("A+B"));
  CHECK_EQ(j.find("user")->str_or("username"), std::string("alice"));
  CHECK(j.find("completedAt")->is_string());
  CHECK_EQ(j.str_or("code"), std::string(PY));
  CHECK(j.find("errorMessage")->is_null());
  // hidden test output must be redacted
  auto& logs = j.find("executionLogs")->as_array();
  CHECK(logs[1].find("testCase")->bool_or("isHidden"));
  CHECK_EQ(logs[1].str_or("stdout"), std::string(""));
  CHECK_EQ(logs[0].str_or("stdout"), std::string("8\n"));
  auto lst = http(f.server.port(), "GET", "/api/submissions?limit=5");
  CHECK_EQ(Json::parse(lst.body).find("submissions")->as_array().size(), 1u);
  CHECK_EQ(http(f.server.port(), "GET", "/api/submissions?limit=abc").status, 400);
  auto lb = Json::parse(http(f.server.port(), "GET", "/api/leaderboard").body);
  auto& rows = lb.find("leaderboard")->as_array();
  CHECK_EQ(rows[0].str_or("username"), std::string("alice"));
  CHECK_EQ(rows[0].int_or("accepted"), 1);
  CHECK_EQ(rows[0].int_or("acceptanceRate"), 100);
}
TEST(http_sse_stream_delivers_ordered_events_and_done) {
  Fixture f;
  std::string id = Json::parse(post_sub(f.server.port(), submit_body(PY)).body).str_or("submissionId");
  auto s = http(f.server.port(), "GET", "/api/submissions/" + id + "/stream");
  CHECK_EQ(s.status, 200);
  CHECK(s.head.find("text/event-stream") != std::string::npos);
  size_t a = s.body.find("COMPILING"), b = s.body.find("RUNNING"), c = s.body.find("\"type\":\"final\""), d = s.body.find("event: done");
  CHECK(a != std::string::npos && b != std::string::npos && c != std::string::npos && d != std::string::npos);
  CHECK(a < b && b < c && c < d);
  // late subscriber gets the full buffered history immediately
  auto late = http(f.server.port(), "GET", "/api/submissions/" + id + "/stream");
  CHECK(late.body.find("event: done") != std::string::npos);
  CHECK(late.body.find("\"type\":\"testcase\"") != std::string::npos);
  CHECK_EQ(http(f.server.port(), "GET", "/api/submissions/zzz/stream").status, 404);
}
TEST(http_api_root_matches_nextjs_route) {
  Fixture f;
  int p = f.server.port();
  auto r = http(p, "GET", "/api");
  CHECK_EQ(r.status, 200);
  CHECK_EQ(Json::parse(r.body).str_or("message"), std::string("Hello, world!"));
  CHECK_EQ(http(p, "POST", "/api").status, 405);
}
TEST(http_validation_errors) {
  Fixture f;
  int p = f.server.port();
  CHECK_EQ(post_sub(p, "{not json").status, 400);
  CHECK_EQ(post_sub(p, "[]").status, 400);
  CHECK_EQ(post_sub(p, "{\"problemId\":\"sum\"}").status, 400);
  CHECK_EQ(post_sub(p, submit_body("print(1)", "brainfuck")).status, 400);
  CHECK_EQ(post_sub(p, submit_body("   \n")).status, 400);
  CHECK_EQ(post_sub(p, submit_body(std::string(70000, 'x'))).status, 400);
  CHECK_EQ(post_sub(p, submit_body("print(1)"), "ghost").status, 404);
  Json bad = Json::parse(submit_body("print(1)")); bad["problemId"] = "nope";
  CHECK_EQ(post_sub(p, bad.dump()).status, 404);
  Json nonstr = Json::parse(submit_body("print(1)")); nonstr["code"] = 5;
  CHECK_EQ(post_sub(p, nonstr.dump()).status, 400);
  CHECK_EQ(Json::parse(http(p, "GET", "/api/submissions").body).find("submissions")->as_array().size(), 0u);  // nothing enqueued
}
TEST(http_malformed_requests_are_rejected_not_crashed) {
  Fixture f;
  int p = f.server.port();
  CHECK_EQ(raw(p, "GARBAGE\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "GET /x HTTP/2.0\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "get /x HTTP/1.1\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "GET x HTTP/1.1\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "POST /api/submissions HTTP/1.1\r\n\r\n").status, 411);
  CHECK_EQ(raw(p, "POST /api/submissions HTTP/1.1\r\nContent-Length: -5\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "POST /api/submissions HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n").status, 413);
  CHECK_EQ(raw(p, "POST /api/submissions HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").status, 501);
  CHECK_EQ(raw(p, "GET /x HTTP/1.1\r\nBad Header\r\n\r\n").status, 400);
  CHECK_EQ(raw(p, "GET /x HTTP/1.1\r\n" + std::string(20000, 'a') + ": b\r\n\r\n").status, 431);
  // path traversal style input is just an unknown route
  CHECK_EQ(raw(p, "GET /api/../../etc/passwd HTTP/1.1\r\n\r\n").status, 404);
  CHECK_EQ(http(p, "GET", "/health").status, 200);  // still alive
}
TEST(http_slow_client_times_out) {
  ServerConfig sc; sc.read_timeout_ms = 300;
  Fixture f(100, sc);
  int fd = connect_to(f.server.port());
  send(fd, "GET /health HT", 14, 0);
  char b[512]; ssize_t n = recv(fd, b, sizeof b, 0);
  CHECK(n > 0);
  CHECK(std::string(b, n).find("408") != std::string::npos);
  close(fd);
}
TEST(http_partial_body_split_across_packets) {
  Fixture f;
  std::string body = submit_body(PY);
  int fd = connect_to(f.server.port());
  std::string head = "POST /api/submissions?userId=u1 HTTP/1.1\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n";
  send(fd, head.data(), head.size(), 0);
  usleep(100000);
  send(fd, body.data(), body.size() / 2, 0);
  usleep(100000);
  send(fd, body.data() + body.size() / 2, body.size() - body.size() / 2, 0);
  char b[1024]; ssize_t n = recv(fd, b, sizeof b, 0);
  CHECK(n > 0 && std::string(b, n).find("201") != std::string::npos);
  close(fd);
}
TEST(http_rate_limit_returns_429_with_retry_after) {
  Fixture f(2);
  int p = f.server.port();
  CHECK_EQ(post_sub(p, submit_body(PY)).status, 201);
  CHECK_EQ(post_sub(p, submit_body(PY)).status, 201);
  auto r = post_sub(p, submit_body(PY));
  CHECK_EQ(r.status, 429);
  CHECK(r.head.find("Retry-After:") != std::string::npos);
  CHECK_EQ(post_sub(p, submit_body(PY), "u2").status, 201);  // per-user
}
TEST(http_concurrent_submissions_all_judged_correctly) {
  Fixture f;
  std::vector<std::string> ids(8);
  std::vector<std::thread> th;
  for (int i = 0; i < 8; i++) th.emplace_back([&, i] {
    std::string code = i % 2 ? PY : "a,b=map(int,input().split())\nprint(a+b+1)\n";
    ids[i] = Json::parse(post_sub(f.server.port(), submit_body(code, "python", i % 2 ? "u1" : "u2")).body).str_or("submissionId");
  });
  for (auto& t : th) t.join();
  for (int i = 0; i < 8; i++) {
    CHECK(f.engine.wait_done(ids[i], 40000));
    Json j; f.engine.submission_json(ids[i], j);
    CHECK_EQ(j.str_or("status"), std::string(i % 2 ? "ACCEPTED" : "WRONG_ANSWER"));
  }
  Json st = f.engine.stats();
  CHECK_EQ(st.find("throughput")->int_or("processed"), 8);
  CHECK_EQ(st.find("queue")->int_or("active"), 0);
}
TEST(engine_premium_priority_runs_first) {
  EngineConfig c; c.workers = 1; c.rate_limit = 100;
  Engine e(c);
  Problem p; p.id = "sum"; p.time_limit_ms = 3000;
  p.tests = {{"s0", "3 5\n", "8\n", false, 0}};
  e.add_problem(p);
  e.add_user({"free", "f", "", Tier::Free}); e.add_user({"pro", "p", "", Tier::Premium});
  // enqueue before workers start so ordering is purely priority-based
  std::vector<std::string> ids;
  for (int i = 0; i < 3; i++) ids.push_back(e.submit({"sum", "free", "python", PY}).id);
  std::string pro = e.submit({"sum", "pro", "python", PY}).id;
  e.start();
  CHECK(e.wait_done(pro, 20000));
  for (auto& id : ids) CHECK(e.wait_done(id, 20000));
  Json jp, jf; e.submission_json(pro, jp); e.submission_json(ids[0], jf);
  CHECK(jp.int_or("completedAt") <= jf.int_or("completedAt"));
  CHECK(jp.int_or("completedAt") <= [&] { Json t; e.submission_json(ids[2], t); return t.int_or("completedAt"); }());
}
TEST(engine_loads_problem_file_and_rejects_bad_json) {
  Engine e;
  std::ifstream f(std::string(AETHER_DATA_DIR) + "/problems.json");
  CHECK(static_cast<bool>(f));
  std::stringstream ss; ss << f.rdbuf();
  e.load_problems_json(ss.str());
  CHECK_EQ(e.list_problems().size(), 4u);
  bool threw = false;
  try { e.load_problems_json("{\"nope\":1}"); } catch (const JsonError&) { threw = true; }
  CHECK(threw);
}
TEST(url_decode_and_query_parsing) {
  CHECK_EQ(url_decode("a%20b+c%zz%4"), std::string("a b c%zz%4"));
  HttpRequest r;
  CHECK_EQ(parse_request_head("GET /a%2Fb?x=1&limit=7&y=%41 HTTP/1.1\r\nHost: h\r\nX-Y:  v  \r\n\r\n", r), std::string(""));
  CHECK_EQ(r.path, std::string("/a/b"));
  CHECK_EQ(r.query_param("limit"), std::string("7"));
  CHECK_EQ(r.query_param("y"), std::string("A"));
  CHECK_EQ(r.header("x-y"), std::string("v"));
}

TEST(http_login_token_and_user_resolution) {
  Fixture f;
  int p = f.server.port();
  auto lg = http(p, "POST", "/api/users", "{\"username\":\"bob\"}");
  CHECK_EQ(lg.status, 200);
  Json lj = Json::parse(lg.body);
  std::string token = lj.str_or("token");
  CHECK_EQ(token.size(), 32u);
  CHECK_EQ(lj.find("user")->str_or("tier"), std::string("PREMIUM"));
  CHECK_EQ(http(p, "POST", "/api/users", "{\"username\":\"nobody\"}").status, 404);
  CHECK_EQ(http(p, "POST", "/api/users", "{}").status, 400);
  std::string body = submit_body(PY);
  auto r = raw(p, "POST /api/submissions HTTP/1.1\r\nAuthorization: Bearer " + token + "\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body);
  CHECK_EQ(r.status, 201);
  Json rj = Json::parse(r.body);
  CHECK_EQ(rj.str_or("tier"), std::string("PREMIUM"));
  CHECK_EQ(rj.int_or("priority"), 10);
  CHECK(rj.str_or("streamUrl").find("/stream") != std::string::npos);
  auto bad = raw(p, "POST /api/submissions HTTP/1.1\r\nAuthorization: Bearer nope\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body);
  CHECK_EQ(bad.status, 404);  // an unknown token never silently becomes another user
  // anonymous callers fall back to the first user, like the TypeScript engine
  auto anon = http(p, "POST", "/api/submissions", body);
  CHECK_EQ(anon.status, 201);
}
TEST(http_stats_shape_matches_frontend_contract) {
  Fixture f;
  Json st = Json::parse(http(f.server.port(), "GET", "/api/stats").body);
  for (const char* k : {"queue", "workers", "containerPool", "throughput"}) CHECK(st.find(k) != nullptr);
  CHECK(st.find("throughput")->find("lastHourAccepted") != nullptr);
  CHECK(st.find("workers")->int_or("count") == 2);
  CHECK(st.find("uptimeMs") != nullptr);
}
