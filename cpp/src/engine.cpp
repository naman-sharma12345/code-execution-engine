#include "aether/engine.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <ctime>
#include <cstdio>
#include <random>
#include <set>
#include <fstream>
#include <sstream>

#include "aether/judge.hpp"

namespace aether {

long long now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

namespace {
std::string random_hex(int bytes) {
  static std::mutex m;
  static std::random_device rd;
  std::lock_guard<std::mutex> g(m);
  std::string s;
  char b[3];
  for (int i = 0; i < bytes; i++) { std::snprintf(b, sizeof b, "%02x", static_cast<unsigned>(rd() & 0xFF)); s += b; }
  return s;
}
bool blank(const std::string& s) {
  return std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isspace(c); });
}
}  // namespace

Engine::Engine(EngineConfig cfg)
    : cfg_(cfg), limiter_(cfg.rate_limit, cfg.rate_window_ms) {
  started_at_ = now_ms();
}

Engine::~Engine() { stop(); }

void Engine::add_problem(Problem p) {
  std::lock_guard<std::mutex> g(m_);
  if (!problems_.count(p.id)) problem_order_.push_back(p.id);
  std::string id = p.id;
  problems_[id] = std::move(p);
}
void Engine::add_user(User u) {
  std::lock_guard<std::mutex> g(m_);
  std::string id = u.id;
  if (!users_.count(id)) user_order_.push_back(id);
  users_[id] = std::move(u);
}

void Engine::load_problems_json(const std::string& text) {
  Json root = Json::parse(text);
  const Json* arr = root.is_array() ? &root : root.find("problems");
  if (!arr || !arr->is_array()) throw JsonError("problems json: expected array or {problems:[]}");
  for (auto& pj : arr->as_array()) {
    Problem p;
    p.id = pj.str_or("id");
    if (p.id.empty()) throw JsonError("problems json: problem without id");
    p.title = pj.str_or("title");
    p.description = pj.str_or("description");
    p.difficulty = pj.str_or("difficulty", "EASY");
    p.tags = pj.str_or("tags");
    p.time_limit_ms = static_cast<int>(std::clamp<long long>(pj.int_or("timeLimit", 2000), 100, 60000));
    p.cpu_time_limit_ms = static_cast<int>(std::clamp<long long>(pj.int_or("cpuTimeLimit", p.time_limit_ms), 100, 60000));
    p.memory_limit_mb = static_cast<int>(std::clamp<long long>(pj.int_or("memoryLimit", 256), 16, 4096));
    if (auto* tcs = pj.find("testCases"); tcs && tcs->is_array()) {
      int n = 0;
      for (auto& tj : tcs->as_array()) {
        TestCase t;
        t.id = p.id + "_tc" + std::to_string(n);
        t.input = tj.str_or("input");
        t.expected = tj.str_or("expectedOutput");
        t.hidden = tj.bool_or("isHidden");
        t.order = static_cast<int>(tj.int_or("order", n));
        p.tests.push_back(std::move(t));
        n++;
      }
    }
    add_problem(std::move(p));
  }
}

void Engine::start() {
  if (running_.exchange(true)) return;
  int n = std::max(1, cfg_.workers);
  for (int i = 0; i < n; i++) workers_.emplace_back([this, i] { worker_loop(i); });
}

void Engine::stop() {
  if (!running_.exchange(false)) return;
  queue_.close();
  for (auto& t : workers_) if (t.joinable()) t.join();
  workers_.clear();
  cv_.notify_all();
}

SubmitResult Engine::submit(const SubmitRequest& r) {
  SubmitResult res;
  Language lang;
  if (!parse_language(r.language, lang)) { res.kind = SubmitResult::BadRequest; res.error = "Unsupported language: " + r.language; return res; }
  if (blank(r.code)) { res.kind = SubmitResult::BadRequest; res.error = "Code cannot be empty"; return res; }
  if (r.code.size() > cfg_.max_code_bytes) { res.kind = SubmitResult::BadRequest; res.error = "Source code exceeds 64KB limit"; return res; }
  if (r.code.find('\0') != std::string::npos) { res.kind = SubmitResult::BadRequest; res.error = "Source code contains NUL bytes"; return res; }
  Tier tier;
  {
    std::lock_guard<std::mutex> g(m_);
    if (!problems_.count(r.problem_id)) { res.kind = SubmitResult::NotFound; res.error = "Problem not found: " + r.problem_id; return res; }
    auto u = users_.find(r.user_id);
    if (u == users_.end()) { res.kind = SubmitResult::NotFound; res.error = "User not found: " + r.user_id; return res; }
    tier = u->second.tier;
  }
  RateDecision d = limiter_.hit(r.user_id);
  if (!d.allowed) {
    rejected_++;
    res.kind = SubmitResult::RateLimited;
    res.error = "Rate limit exceeded";
    res.retry_after_ms = d.retry_after_ms;
    return res;
  }
  auto s = std::make_shared<Submission>();
  s->id = "sub_" + random_hex(10);
  s->problem_id = r.problem_id;
  s->user_id = r.user_id;
  s->code = r.code;
  s->language = lang;
  s->tier = tier;
  s->created_at = now_ms();
  std::string id = s->id;
  {
    std::lock_guard<std::mutex> g(m_);
    subs_[id] = std::move(s);
    sub_order_.push_back(id);
    evict_locked();
  }
  Json ev = Json::object();
  ev["type"] = "status"; ev["status"] = "PENDING"; ev["message"] = "Queued";
  push_event(id, std::move(ev));
  queue_.add(SubmissionJob{id}, tier == Tier::Premium ? 10 : 0);
  res.id = id;
  res.priority = tier == Tier::Premium ? 10 : 0;
  res.tier = to_string(tier);
  return res;
}

void Engine::evict_locked() {
  while (sub_order_.size() > cfg_.max_submissions_kept) {
    // Evict the oldest *finished* submission; never drop one that is still queued or running.
    auto it = std::find_if(sub_order_.begin(), sub_order_.end(), [&](const std::string& id) { return subs_[id]->done; });
    if (it == sub_order_.end()) break;
    subs_.erase(*it);
    sub_order_.erase(it);
  }
}

void Engine::push_event(const std::string& id, Json ev) {
  ev["submissionId"] = id;
  ev["timestamp"] = now_ms();
  {
    std::lock_guard<std::mutex> g(m_);
    auto it = subs_.find(id);
    if (it == subs_.end()) return;
    if (it->second->events.size() < 2000) it->second->events.push_back(std::move(ev));
  }
  cv_.notify_all();
}

Json Engine::case_json(const CaseResult& c, bool hidden) {
  Json j = Json::object();
  j["testCaseId"] = c.test_case_id;
  j["status"] = to_string(c.status);
  // Hidden tests: a program can echo its stdin, so never return output for them.
  j["stdout"] = hidden ? std::string() : c.stdout_text;
  j["stderr"] = hidden ? std::string() : c.stderr_text;
  j["hidden"] = hidden;
  j["exitCode"] = c.exit_code;
  j["executionTime"] = c.time_ms;
  j["memoryUsed"] = c.memory_kb;
  return j;
}

Json Engine::verdict_json(const Submission& s, const Problem* p) {
  Json j = Json::object();
  j["submissionId"] = s.id;
  j["status"] = to_string(s.verdict.status);
  j["executionTime"] = s.verdict.time_ms;
  j["memoryUsed"] = s.verdict.memory_kb;
  j["testCasesPassed"] = s.verdict.passed;
  j["totalTestCases"] = s.verdict.total;
  if (!s.verdict.error_message.empty()) j["errorMessage"] = s.verdict.error_message;
  if (!s.verdict.compile_output.empty()) j["compileOutput"] = s.verdict.compile_output;
  Json arr = Json::array();
  for (size_t i = 0; i < s.verdict.cases.size(); i++) {
    bool hidden = false;
    if (p) for (auto& t : p->tests) if (t.id == s.verdict.cases[i].test_case_id) hidden = t.hidden;
    arr.push(case_json(s.verdict.cases[i], hidden));
  }
  j["results"] = std::move(arr);
  return j;
}

void Engine::worker_loop(int) {
  while (running_) {
    auto job = queue_.wait_poll(200);
    if (!job) continue;
    bool retry = false;
    busy_++;
    try {
      process(job->payload.submission_id, job->attempts, job->max_attempts, retry);
      if (retry) queue_.fail(job->id, "infrastructure error");
      else queue_.complete(job->id);
    } catch (const std::exception& e) {
      queue_.fail(job->id, e.what());
    } catch (...) {
      queue_.fail(job->id, "unknown error");
    }
    busy_--;
  }
}

void Engine::process(const std::string& id, int attempt, int max_attempts, bool& retry) {
  Problem prob;
  Language lang;
  std::string code;
  long long created;
  {
    std::lock_guard<std::mutex> g(m_);
    auto it = subs_.find(id);
    if (it == subs_.end()) return;  // evicted or unknown: drop the job
    auto p = problems_.find(it->second->problem_id);
    if (p == problems_.end()) return;
    prob = p->second;
    lang = it->second->language;
    code = it->second->code;
    created = it->second->created_at;
    it->second->status = Status::Compiling;
  }
  Verdict v = judge(prob, lang, code, [&](const JudgeEvent& e) {
    Json ev = Json::object();
    switch (e.type) {
      case JudgeEvent::StatusChange: {
        { std::lock_guard<std::mutex> g(m_); auto it = subs_.find(id); if (it != subs_.end()) it->second->status = e.status; }
        ev["type"] = "status"; ev["status"] = to_string(e.status); ev["message"] = e.message; break;
      }
      case JudgeEvent::Compile: ev["type"] = "compile"; ev["compileOutput"] = e.message; break;
      case JudgeEvent::Log: ev["type"] = "log"; ev["message"] = e.message; break;
      case JudgeEvent::Case: {
        bool hidden = false;
        for (auto& t : prob.tests) if (t.id == e.result.test_case_id) hidden = t.hidden;
        ev["type"] = "testcase"; ev["testCase"] = case_json(e.result, hidden); break;
      }
    }
    push_event(id, std::move(ev));
  });
  if (v.infra_error && attempt < max_attempts) {
    Json ev = Json::object();
    ev["type"] = "log"; ev["message"] = "Infrastructure error, retrying: " + v.error_message;
    push_event(id, std::move(ev));
    retry = true;
    return;
  }
  long long done_at = now_ms();
  Json final_ev = Json::object();
  {
    std::lock_guard<std::mutex> g(m_);
    auto it = subs_.find(id);
    if (it == subs_.end()) return;
    Submission& s = *it->second;
    s.verdict = std::move(v);
    s.status = s.verdict.status;
    s.completed_at = done_at;
    final_ev["result"] = verdict_json(s, &prob);
  }
  final_ev["type"] = "final";
  final_ev["status"] = final_ev["result"].str_or("status");
  processed_++;
  if (final_ev["result"].str_or("status") == "ACCEPTED") accepted_++;
  latency_sum_ += done_at - created;
  {
    std::lock_guard<std::mutex> g(m_);
    auto it = subs_.find(id);
    if (it != subs_.end()) it->second->done = true;  // set before the final event so waiters see both
  }
  if (!cfg_.persist_path.empty()) {
    std::shared_ptr<Submission> sp;
    { std::lock_guard<std::mutex> g(m_); auto it = subs_.find(id); if (it != subs_.end()) sp = it->second; }
    if (sp) persist(*sp);
  }
  push_event(id, std::move(final_ev));
}

bool Engine::wait_events(const std::string& id, size_t& index, std::vector<Json>& out, bool& done, int timeout_ms) {
  std::unique_lock<std::mutex> lk(m_);
  auto it = subs_.find(id);
  if (it == subs_.end()) return false;
  std::shared_ptr<Submission> s = it->second;
  auto pred = [&] { return s->events.size() > index || s->done || !running_; };
  cv_.wait_for(lk, std::chrono::milliseconds(timeout_ms), pred);
  // The submission may have been evicted while we waited.
  auto it2 = subs_.find(id);
  if (it2 == subs_.end()) return false;
  out.assign(s->events.begin() + static_cast<long>(std::min(index, s->events.size())), s->events.end());
  index = s->events.size();
  bool has_final = !s->events.empty() && s->events.back().str_or("type") == "final";
  done = s->done && has_final;
  return true;
}

bool Engine::wait_done(const std::string& id, int timeout_ms) {
  std::unique_lock<std::mutex> lk(m_);
  auto it = subs_.find(id);
  if (it == subs_.end()) return false;
  std::shared_ptr<Submission> s = it->second;
  return cv_.wait_for(lk, std::chrono::milliseconds(timeout_ms), [&] { return s->done; });
}

// ---- reads (JSON shapes follow the TypeScript API / src/lib/api.ts contract) ----

namespace {
std::string iso(long long ms) {
  time_t t = static_cast<time_t>(ms / 1000);
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char b[96];
  std::snprintf(b, sizeof b, "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ", tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday,
                tmv.tm_hour, tmv.tm_min, tmv.tm_sec, ms % 1000);
  return b;
}
Json tags_json(const std::string& tags) {
  Json a = Json::array();
  size_t i = 0;
  while (i <= tags.size()) {
    size_t e = tags.find(',', i);
    std::string t = tags.substr(i, e == std::string::npos ? std::string::npos : e - i);
    while (!t.empty() && t.front() == ' ') t.erase(t.begin());
    while (!t.empty() && t.back() == ' ') t.pop_back();
    if (!t.empty()) a.push(t);
    if (e == std::string::npos) break;
    i = e + 1;
  }
  return a;
}
}  // namespace

std::vector<Json> Engine::list_problems() const {
  std::lock_guard<std::mutex> g(m_);
  std::map<std::string, long long> counts;
  for (auto& [id, s] : subs_) counts[s->problem_id]++;
  std::vector<Json> out;
  for (auto& id : problem_order_) {
    const Problem& p = problems_.at(id);
    Json j = Json::object();
    j["id"] = p.id; j["title"] = p.title; j["description"] = p.description;
    j["timeLimit"] = p.time_limit_ms; j["memoryLimit"] = p.memory_limit_mb;
    j["difficulty"] = p.difficulty; j["tags"] = tags_json(p.tags);
    j["totalTestCases"] = static_cast<long long>(p.tests.size());
    j["totalSubmissions"] = counts[p.id];
    out.push_back(std::move(j));
  }
  return out;
}

bool Engine::problem_json(const std::string& id, Json& out) const {
  std::lock_guard<std::mutex> g(m_);
  auto it = problems_.find(id);
  if (it == problems_.end()) return false;
  const Problem& p = it->second;
  long long subs = 0;
  for (auto& [sid, s] : subs_) if (s->problem_id == id) subs++;
  Json j = Json::object();
  j["id"] = p.id; j["title"] = p.title; j["description"] = p.description;
  j["timeLimit"] = p.time_limit_ms; j["cpuTimeLimit"] = p.cpu_time_limit_ms; j["memoryLimit"] = p.memory_limit_mb;
  j["difficulty"] = p.difficulty; j["tags"] = tags_json(p.tags);
  j["totalTestCases"] = static_cast<long long>(p.tests.size());
  j["totalSubmissions"] = subs;
  Json samples = Json::array();
  long long hidden = 0;
  for (auto& t : p.tests) {
    if (t.hidden) { hidden++; continue; }  // hidden tests are never exposed
    Json c = Json::object();
    c["id"] = t.id; c["input"] = t.input; c["expectedOutput"] = t.expected; c["order"] = t.order;
    samples.push(std::move(c));
  }
  j["sampleTestCases"] = std::move(samples);
  j["hiddenTestCases"] = hidden;
  out = std::move(j);
  return true;
}

namespace {
Json user_brief(const User* u, const std::string& fallback_id) {
  Json j = Json::object();
  j["id"] = u ? u->id : fallback_id;
  j["username"] = u ? u->username : std::string("unknown");
  j["subscriptionTier"] = u ? std::string(to_string(u->tier)) : std::string("FREE");
  return j;
}
}  // namespace

// Builds the list-item shape; caller holds m_.
static Json sub_list_item(const Submission& s, const std::map<std::string, Problem>& problems, const std::map<std::string, User>& users) {
  auto pit = problems.find(s.problem_id);
  auto uit = users.find(s.user_id);
  Json j = Json::object();
  j["id"] = s.id; j["problemId"] = s.problem_id; j["userId"] = s.user_id;
  j["language"] = to_string(s.language);
  j["status"] = to_string(s.status);
  j["executionTime"] = s.verdict.time_ms; j["memoryUsed"] = s.verdict.memory_kb;
  j["testCasesPassed"] = s.verdict.passed; j["totalTestCases"] = s.verdict.total;
  j["createdAt"] = iso(s.created_at);
  j["completedAt"] = s.completed_at ? Json(iso(s.completed_at)) : Json(nullptr);
  Json pj = Json::object();
  pj["id"] = s.problem_id; pj["title"] = pit == problems.end() ? std::string("?") : pit->second.title;
  j["problem"] = std::move(pj);
  j["user"] = user_brief(uit == users.end() ? nullptr : &uit->second, s.user_id);
  return j;
}

bool Engine::submission_json(const std::string& id, Json& out) const {
  std::lock_guard<std::mutex> g(m_);
  auto it = subs_.find(id);
  if (it == subs_.end()) return false;
  const Submission& s = *it->second;
  auto pit = problems_.find(s.problem_id);
  Json j = sub_list_item(s, problems_, users_);
  j["code"] = s.code;
  j["errorMessage"] = s.verdict.error_message.empty() ? Json(nullptr) : Json(s.verdict.error_message);
  j["compileOutput"] = s.verdict.compile_output.empty() ? Json(nullptr) : Json(s.verdict.compile_output);
  Json logs = Json::array();
  for (size_t i = 0; s.done && i < s.verdict.cases.size(); i++) {
    const CaseResult& c = s.verdict.cases[i];
    bool hidden = false; int order = static_cast<int>(i);
    if (pit != problems_.end()) for (auto& t : pit->second.tests) if (t.id == c.test_case_id) { hidden = t.hidden; order = t.order; }
    Json l = Json::object();
    l["id"] = s.id + "_" + std::to_string(i);
    l["submissionId"] = s.id; l["testCaseId"] = c.test_case_id; l["status"] = to_string(c.status);
    l["stdout"] = hidden ? std::string() : c.stdout_text;  // never echo output for hidden tests
    l["stderr"] = hidden ? std::string() : c.stderr_text;
    l["exitCode"] = c.exit_code; l["executionTime"] = c.time_ms; l["memoryUsed"] = c.memory_kb;
    Json tc = Json::object(); tc["isHidden"] = hidden; tc["order"] = order;
    l["testCase"] = std::move(tc);
    logs.push(std::move(l));
  }
  j["executionLogs"] = std::move(logs);
  Json pj = Json::object();
  pj["id"] = s.problem_id;
  pj["title"] = pit == problems_.end() ? std::string("?") : pit->second.title;
  pj["timeLimit"] = pit == problems_.end() ? 0 : pit->second.time_limit_ms;
  pj["memoryLimit"] = pit == problems_.end() ? 0 : pit->second.memory_limit_mb;
  j["problem"] = std::move(pj);
  out = std::move(j);
  return true;
}

std::vector<Json> Engine::list_submissions(size_t limit) const {
  std::lock_guard<std::mutex> g(m_);
  std::vector<Json> out;
  for (auto it = sub_order_.rbegin(); it != sub_order_.rend() && out.size() < limit; ++it)
    out.push_back(sub_list_item(*subs_.at(*it), problems_, users_));
  return out;
}

std::vector<Json> Engine::list_users() const {
  std::lock_guard<std::mutex> g(m_);
  std::vector<Json> out;
  for (auto& id : user_order_) {
    const User& u = users_.at(id);
    Json j = Json::object();
    j["id"] = u.id; j["username"] = u.username; j["email"] = u.email;
    j["subscriptionTier"] = to_string(u.tier); j["createdAt"] = iso(started_at_);
    out.push_back(std::move(j));
  }
  return out;
}

bool Engine::login(const std::string& username, Json& out) {
  std::lock_guard<std::mutex> g(m_);
  for (auto& [id, u] : users_) {
    if (u.username != username) continue;
    std::string token = random_hex(16);
    if (sessions_.size() >= 10000) sessions_.erase(sessions_.begin());  // bounded memory
    sessions_[token] = u.id;
    Json uj = Json::object();
    uj["id"] = u.id; uj["username"] = u.username; uj["tier"] = to_string(u.tier);
    out = Json::object();
    out["token"] = token; out["user"] = std::move(uj);
    return true;
  }
  return false;
}

bool Engine::resolve_user(const std::string& auth_header, const std::string& user_id_param, User& out) const {
  std::lock_guard<std::mutex> g(m_);
  std::string tok = auth_header;
  if (tok.rfind("Bearer ", 0) == 0) tok = tok.substr(7);
  if (!tok.empty()) {
    auto s = sessions_.find(tok);
    if (s != sessions_.end() && users_.count(s->second)) { out = users_.at(s->second); return true; }
    return false;  // a presented-but-unknown token never silently becomes someone else
  }
  if (!user_id_param.empty()) {
    auto u = users_.find(user_id_param);
    if (u != users_.end()) { out = u->second; return true; }
    return false;
  }
  // Same fallback as the TypeScript engine: anonymous callers act as the first user.
  if (!user_order_.empty()) { out = users_.at(user_order_.front()); return true; }
  return false;
}

std::vector<Json> Engine::leaderboard(size_t) const {
  std::lock_guard<std::mutex> g(m_);
  struct Row { std::string id, name, tier; long long acc = 0, total = 0; };
  std::vector<Row> rows;
  for (auto& id : user_order_) { const User& u = users_.at(id); rows.push_back({u.id, u.username, to_string(u.tier), 0, 0}); }
  for (auto& [sid, s] : subs_) {
    if (!s->done) continue;
    for (auto& r : rows) if (r.id == s->user_id) { r.total++; if (s->verdict.status == Status::Accepted) r.acc++; }
  }
  auto rate = [](const Row& r) { return r.total ? static_cast<long long>(std::llround(100.0 * r.acc / r.total)) : 0LL; };
  std::stable_sort(rows.begin(), rows.end(), [&](const Row& a, const Row& b) {
    return a.acc != b.acc ? a.acc > b.acc : rate(a) > rate(b);
  });
  std::vector<Json> out;
  for (auto& r : rows) {
    Json j = Json::object();
    j["id"] = r.id; j["username"] = r.name; j["tier"] = r.tier; j["accepted"] = r.acc; j["total"] = r.total;
    j["acceptanceRate"] = rate(r);
    out.push_back(std::move(j));
  }
  return out;
}

Json Engine::stats() const {
  QueueStats q = const_cast<Engine*>(this)->queue_.stats();
  Json j = Json::object();
  Json qj = Json::object();
  qj["waiting"] = static_cast<long long>(q.waiting); qj["active"] = static_cast<long long>(q.active);
  qj["delayed"] = static_cast<long long>(q.delayed); qj["failed"] = static_cast<long long>(q.failed);
  qj["completed"] = static_cast<long long>(q.completed);
  j["queue"] = std::move(qj);
  Json w = Json::object();
  int busy = busy_.load();
  w["count"] = static_cast<long long>(workers_.size()); w["busy"] = busy;
  w["idle"] = static_cast<long long>(workers_.size()) - busy;
  j["workers"] = std::move(w);
  // Process-per-run sandbox: there is no container pool. Reported for API compatibility.
  Json cp = Json::object();
  cp["total"] = 0; cp["idle"] = 0; cp["inUse"] = 0; cp["warmsPerLanguage"] = Json::object();
  j["containerPool"] = std::move(cp);
  Json t = Json::object();
  long long p = processed_.load(), a = accepted_.load();
  long long total_subs, hour_acc = 0;
  {
    std::lock_guard<std::mutex> g(m_);
    total_subs = static_cast<long long>(subs_.size());
    long long cutoff = now_ms() - 3600 * 1000;
    for (auto& [id, s] : subs_) if (s->done && s->completed_at >= cutoff && s->verdict.status == Status::Accepted) hour_acc++;
  }
  t["processed"] = p; t["accepted"] = a; t["rejected"] = rejected_.load();
  t["avgLatencyMs"] = p ? latency_sum_.load() / p : 0;
  t["totalSubmissions"] = total_subs; t["lastHourAccepted"] = hour_acc; t["lastHourRejected"] = rejected_.load();
  j["throughput"] = std::move(t);
  j["uptimeMs"] = now_ms() - started_at_;
  return j;
}

}  // namespace aether

namespace aether {

namespace {
std::string clip(const std::string& s, size_t n = 4096) { return s.size() > n ? s.substr(0, n) : s; }
bool parse_status(const std::string& n, Status& out) {
  for (Status st : {Status::Pending, Status::Compiling, Status::Running, Status::Accepted, Status::WrongAnswer,
                    Status::TimeLimit, Status::MemoryLimit, Status::RuntimeError, Status::Failed})
    if (n == to_string(st)) { out = st; return true; }
  return false;
}
bool parse_case_status(const std::string& n, CaseStatus& out) {
  for (CaseStatus st : {CaseStatus::Accepted, CaseStatus::WrongAnswer, CaseStatus::TimeLimit, CaseStatus::MemoryLimit,
                        CaseStatus::RuntimeError, CaseStatus::Skipped})
    if (n == to_string(st)) { out = st; return true; }
  return false;
}
Json record_json(const Submission& s) {
  Json j = Json::object();
  j["id"] = s.id; j["problemId"] = s.problem_id; j["userId"] = s.user_id; j["language"] = to_string(s.language);
  j["tier"] = to_string(s.tier); j["status"] = to_string(s.verdict.status); j["code"] = s.code;
  j["timeMs"] = s.verdict.time_ms; j["memoryKb"] = s.verdict.memory_kb; j["passed"] = s.verdict.passed;
  j["total"] = s.verdict.total; j["error"] = s.verdict.error_message; j["compile"] = clip(s.verdict.compile_output);
  j["createdAt"] = s.created_at; j["completedAt"] = s.completed_at;
  Json cs = Json::array();
  for (auto& c : s.verdict.cases) {
    Json cj = Json::object();
    cj["id"] = c.test_case_id; cj["status"] = to_string(c.status); cj["stdout"] = clip(c.stdout_text);
    cj["stderr"] = clip(c.stderr_text); cj["exit"] = c.exit_code; cj["time"] = c.time_ms; cj["mem"] = c.memory_kb;
    cs.push(std::move(cj));
  }
  j["cases"] = std::move(cs);
  return j;
}
}  // namespace

void Engine::persist(const Submission& s) {
  std::string line = record_json(s).dump();
  std::lock_guard<std::mutex> g(persist_m_);
  std::ofstream out(cfg_.persist_path, std::ios::app);
  if (out) out << line << '\n';
}

size_t Engine::load_history(std::string& err) {
  if (cfg_.persist_path.empty()) return 0;
  std::vector<std::string> lines;
  {
    std::ifstream in(cfg_.persist_path);
    std::string ln;
    while (in && std::getline(in, ln)) if (!ln.empty()) lines.push_back(ln);
  }
  // Records are written in completion order; restore them in creation order.
  {
    std::vector<std::pair<long long, std::string>> keyed;
    for (auto& l : lines) {
      long long created = 0;
      try { Json j = Json::parse(l); if (j.is_object()) created = j.int_or("createdAt"); } catch (const JsonError&) {}
      keyed.emplace_back(created, std::move(l));
    }
    std::stable_sort(keyed.begin(), keyed.end(), [](auto& a, auto& b) { return a.first < b.first; });
    lines.clear();
    for (auto& k : keyed) lines.push_back(std::move(k.second));
  }
  // Keep only the newest max_submissions_kept records.
  size_t from = lines.size() > cfg_.max_submissions_kept ? lines.size() - cfg_.max_submissions_kept : 0;
  std::vector<std::string> kept;
  size_t restored = 0;
  for (size_t i = from; i < lines.size(); i++) {
    Json j;
    try { j = Json::parse(lines[i]); } catch (const JsonError&) { continue; }  // torn/corrupt line: skip
    if (!j.is_object()) continue;
    auto s = std::make_shared<Submission>();
    s->id = j.str_or("id"); s->problem_id = j.str_or("problemId"); s->user_id = j.str_or("userId");
    s->code = j.str_or("code");
    Status st = Status::Failed;
    if (s->id.empty() || !parse_language(j.str_or("language"), s->language) || !parse_status(j.str_or("status"), st) || !is_terminal(st)) continue;
    s->tier = j.str_or("tier") == "PREMIUM" ? Tier::Premium : Tier::Free;
    s->status = st;
    s->verdict.status = st;
    s->verdict.time_ms = j.int_or("timeMs"); s->verdict.memory_kb = j.int_or("memoryKb");
    s->verdict.passed = static_cast<int>(j.int_or("passed")); s->verdict.total = static_cast<int>(j.int_or("total"));
    s->verdict.error_message = j.str_or("error"); s->verdict.compile_output = j.str_or("compile");
    s->created_at = j.int_or("createdAt"); s->completed_at = j.int_or("completedAt");
    if (auto* cs = j.find("cases"); cs && cs->is_array()) {
      for (auto& cj : cs->as_array()) {
        CaseResult c; CaseStatus cst = CaseStatus::Skipped;
        parse_case_status(cj.str_or("status"), cst);
        c.status = cst; c.test_case_id = cj.str_or("id"); c.stdout_text = cj.str_or("stdout"); c.stderr_text = cj.str_or("stderr");
        c.exit_code = static_cast<int>(cj.int_or("exit")); c.time_ms = cj.int_or("time"); c.memory_kb = cj.int_or("mem");
        s->verdict.cases.push_back(std::move(c));
      }
    }
    s->done = true;
    Json fin = Json::object();
    fin["type"] = "final"; fin["status"] = to_string(st); fin["submissionId"] = s->id; fin["timestamp"] = s->completed_at;
    {
      std::lock_guard<std::mutex> g(m_);
      if (subs_.count(s->id)) continue;
      auto p = problems_.find(s->problem_id);
      fin["result"] = verdict_json(*s, p == problems_.end() ? nullptr : &p->second);
      s->events.push_back(std::move(fin));
      sub_order_.push_back(s->id);
      subs_[s->id] = std::move(s);
    }
    kept.push_back(lines[i]);
    restored++;
  }
  // Compact: rewrite the file atomically with only the records we kept.
  std::string tmp = cfg_.persist_path + ".tmp";
  {
    std::ofstream out(tmp, std::ios::trunc);
    if (!out) { err = "cannot write " + tmp; return restored; }
    for (auto& l : kept) out << l << '\n';
    out.flush();
    if (!out) { err = "write failed: " + tmp; return restored; }
  }
  if (std::rename(tmp.c_str(), cfg_.persist_path.c_str()) != 0) err = "cannot replace " + cfg_.persist_path;
  return restored;
}

}  // namespace aether
