#include <atomic>
#include <thread>

#include "aether/checker.hpp"
#include "aether/job_queue.hpp"
#include "aether/json.hpp"
#include "aether/rate_limiter.hpp"
#include "testing.hpp"

using namespace aether;

// ---- JSON ----
TEST(json_roundtrip_basic) {
  Json j = Json::parse(R"({"a":1,"b":[true,false,null,"x"],"c":{"d":-2.5e2}})");
  CHECK_EQ(j.int_or("a"), 1);
  CHECK(j.find("b")->as_array().size() == 4);
  CHECK_EQ(j.find("c")->find("d")->as_number(), -250.0);
  Json k = Json::parse(j.dump());
  CHECK_EQ(k.dump(), j.dump());
}
TEST(json_string_escapes_and_unicode) {
  Json j = Json::parse(R"("a\n\t\"\\\/\u00e9\ud83d\ude00")");
  CHECK_EQ(j.as_string(), std::string("a\n\t\"\\/\xC3\xA9\xF0\x9F\x98\x80"));
  CHECK_EQ(Json(std::string("q\"\n\x01")).dump(), std::string("\"q\\\"\\n\\u0001\""));
}
TEST(json_rejects_malformed) {
  const char* bad[] = {"", "{", "[1,]", "{\"a\":}", "01", "1.", "\"\\x\"", "\"\\ud800\"", "tru", "[1] x", "\"a\nb\"", "-", "{'a':1}", "\"\\udc00\""};
  for (auto* b : bad) {
    bool threw = false;
    try { Json::parse(b); } catch (const JsonError&) { threw = true; }
    if (!threw) { std::cerr << "  accepted bad json: " << b << "\n"; }
    CHECK(threw);
  }
}
TEST(json_depth_limit) {
  std::string deep(500, '['), close(500, ']');
  bool threw = false;
  try { Json::parse(deep + close); } catch (const JsonError&) { threw = true; }
  CHECK(threw);
}
TEST(json_dump_sanitizes_invalid_utf8) {
  Json j(std::string("ok\xFF\xFE" "end"));
  Json back = Json::parse(j.dump());
  CHECK_EQ(back.as_string(), std::string("ok\xEF\xBF\xBD\xEF\xBF\xBD" "end"));
  Json trunc(std::string("a\xE2\x82"));  // truncated 3-byte sequence
  CHECK_EQ(Json::parse(trunc.dump()).as_string().substr(0, 1), std::string("a"));
}
TEST(json_numbers) {
  CHECK_EQ(Json(2000000000LL).dump(), std::string("2000000000"));
  CHECK_EQ(Json(0.5).dump(), std::string("0.5"));
  CHECK_EQ(Json::parse("-0").as_number(), 0.0);
  CHECK_EQ(Json::parse("1E3").as_int(), 1000);
}

// ---- Checker ----
TEST(exact_checker_trailing_newline_bug_fixed) {
  ExactChecker c;
  CHECK(c.check("8\n", "8").accepted);   // the TypeScript version rejected this
  CHECK(c.check("8", "8\n\n\n").accepted);
  CHECK(c.check("a b\nc\n", "a b  \r\nc\r\n").accepted);
  CHECK(c.check("\n\n1\n", "1\n").accepted);
}
TEST(exact_checker_rejects_real_differences) {
  ExactChecker c;
  CHECK(!c.check("1 2\n", "1  2\n").accepted);   // inner whitespace matters
  CHECK(!c.check("a\nb\n", "a\n\nb\n").accepted);  // inner blank line matters
  CHECK(!c.check("8\n", "9\n").accepted);
  CHECK(!c.check("8\n", "").accepted);
  CHECK(c.check("", "\n").accepted);
}
TEST(tolerance_checker) {
  ToleranceChecker c(1e-6);
  CHECK(c.check("1.0 2.0", "1.0000001 2").accepted);
  CHECK(!c.check("1.0", "1.1").accepted);
  CHECK(!c.check("1 2", "1").accepted);
  CHECK(!c.check("1", "abc").accepted);
  CHECK(!c.check("1", "nan").accepted);
  CHECK(c.check("1e9", "1000000000.5").accepted);  // relative tolerance for big values
  CHECK(!c.check("inf", "1").accepted);
  CHECK(c.check("inf", "inf").accepted);
}

// ---- Rate limiter ----
TEST(rate_limiter_window) {
  long long now = 0;
  RateLimiter rl(3, 1000, [&] { return now; });
  for (int i = 0; i < 3; i++) CHECK(rl.hit("u").allowed);
  auto d = rl.hit("u");
  CHECK(!d.allowed);
  CHECK_EQ(d.retry_after_ms, 1000);
  CHECK(rl.hit("other").allowed);
  now = 999; CHECK(!rl.hit("u").allowed);
  now = 1000; CHECK(rl.hit("u").allowed);
  CHECK_EQ(rl.peek("u"), 1u);
  now = 5000; rl.cleanup();
  CHECK_EQ(rl.keys(), 0u);
}
TEST(rate_limiter_concurrent_never_exceeds_limit) {
  RateLimiter rl(50, 60000);
  std::atomic<int> allowed{0};
  std::vector<std::thread> th;
  for (int i = 0; i < 8; i++) th.emplace_back([&] { for (int k = 0; k < 100; k++) if (rl.hit("k").allowed) allowed++; });
  for (auto& t : th) t.join();
  CHECK_EQ(allowed.load(), 50);
}

// ---- Queue ----
TEST(queue_priority_then_fifo) {
  JobQueue<int> q;
  q.add(1, 0); q.add(2, 10); q.add(3, 0); q.add(4, 10);
  std::vector<int> order;
  while (auto j = q.poll()) { order.push_back(j->payload); q.complete(j->id); }
  CHECK((order == std::vector<int>{2, 4, 1, 3}));
  CHECK_EQ(q.stats().completed, 4u);
}
TEST(queue_retry_backoff_and_dead_letter) {
  long long now = 0;
  JobQueue<int> q([&] { return now; }, 1000, 30000);
  q.add(7, 0, 3);
  auto j = q.poll(); CHECK(j.has_value());
  CHECK(q.fail(j->id, "boom"));            // attempt 1 -> retry in 1s
  CHECK(!q.poll().has_value());
  now = 999; CHECK(!q.poll().has_value());
  now = 1000; j = q.poll(); CHECK(j.has_value());
  CHECK_EQ(j->attempts, 2);
  CHECK(q.fail(j->id, "boom"));            // attempt 2 -> retry in 2s
  now = 2999; CHECK(!q.poll().has_value());
  now = 3000; j = q.poll(); CHECK(j.has_value());
  CHECK(!q.fail(j->id, "boom"));           // attempt 3 -> dead letter
  CHECK_EQ(q.stats().failed, 1u);
  auto dead = q.dead_letters(); CHECK_EQ(dead.size(), 1u);
  CHECK(q.requeue_dead(dead[0].id));
  j = q.poll(); CHECK(j.has_value()); CHECK_EQ(j->attempts, 1);
  CHECK(!q.requeue_dead("nope"));
}
TEST(queue_backoff_capped) {
  long long now = 0;
  JobQueue<int> q([&] { return now; }, 1000, 3000);
  q.add(1, 0, 10);
  long long last = 0;
  for (int i = 0; i < 5; i++) {
    auto j = q.poll();
    while (!j) { now += 100; j = q.poll(); }
    last = now;
    q.fail(j->id, "x");
  }
  long long before = now;
  now += 2999; CHECK(!q.poll().has_value());
  now = before + 3000; CHECK(q.poll().has_value());
  (void)last;
}
TEST(queue_unknown_ids_are_ignored) {
  JobQueue<int> q;
  q.complete("x");
  CHECK(!q.fail("x", "e"));
  CHECK_EQ(q.stats().active, 0u);
}
TEST(queue_blocking_pop_wakes_on_add_and_close) {
  JobQueue<int> q;
  std::thread t([&] { std::this_thread::sleep_for(std::chrono::milliseconds(50)); q.add(5, 0); });
  auto j = q.wait_poll(2000);
  CHECK(j.has_value());
  t.join();
  std::thread c([&] { std::this_thread::sleep_for(std::chrono::milliseconds(50)); q.close(); });
  auto none = q.wait_poll(5000);
  CHECK(!none.has_value());
  c.join();
}
TEST(queue_concurrent_consumers_get_each_job_once) {
  JobQueue<int> q;
  for (int i = 0; i < 500; i++) q.add(i, i % 3);
  std::atomic<int> sum{0}, n{0};
  std::vector<std::thread> th;
  for (int w = 0; w < 4; w++) th.emplace_back([&] {
    while (auto j = q.poll()) { sum += j->payload; n++; q.complete(j->id); }
  });
  for (auto& t : th) t.join();
  CHECK_EQ(n.load(), 500);
  CHECK_EQ(sum.load(), 499 * 500 / 2);
}
