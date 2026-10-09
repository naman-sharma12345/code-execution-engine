// Engine: problem catalog, users, submissions, priority queue and worker pool.
#pragma once
#include <atomic>
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "aether/job_queue.hpp"
#include "aether/json.hpp"
#include "aether/rate_limiter.hpp"
#include "aether/types.hpp"

namespace aether {

struct User { std::string id, username, email; Tier tier = Tier::Free; };

struct SubmissionJob { std::string submission_id; };

struct Submission {
  std::string id, problem_id, user_id, code;
  Language language = Language::Cpp;
  Tier tier = Tier::Free;
  Status status = Status::Pending;
  Verdict verdict;
  long long created_at = 0, completed_at = 0;
  std::vector<Json> events;  // buffered for late SSE subscribers
  bool done = false;
};

struct SubmitRequest { std::string problem_id, user_id, language, code; };
struct SubmitResult {
  enum Kind { Ok, BadRequest, NotFound, RateLimited } kind = Ok;
  std::string id, error, tier;
  int priority = 0;
  long long retry_after_ms = 0;
};

struct EngineConfig {
  int workers = 2;
  size_t max_code_bytes = 64 * 1024;
  int rate_limit = 5;
  long long rate_window_ms = 60000;
  size_t max_submissions_kept = 5000;  // oldest finished submissions are evicted
};

class Engine {
 public:
  explicit Engine(EngineConfig cfg = {});
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  void load_problems_json(const std::string& json_text);  // throws JsonError
  void add_problem(Problem p);
  void add_user(User u);
  void start();
  void stop();  // drains nothing: in-flight judge calls finish, queued jobs are dropped

  SubmitResult submit(const SubmitRequest& r);

  // Reads (copies made under lock).
  std::vector<Json> list_problems() const;
  bool problem_json(const std::string& id, Json& out) const;
  bool submission_json(const std::string& id, Json& out) const;
  std::vector<Json> list_submissions(size_t limit) const;
  std::vector<Json> list_users() const;
  bool login(const std::string& username, Json& out);  // {token,user}
  bool resolve_user(const std::string& auth_header, const std::string& user_id_param, User& out) const;
  std::vector<Json> leaderboard(size_t limit) const;
  Json stats() const;

  // SSE support: blocks until events after `index` exist, the stream is done, or timeout.
  // Returns false if the submission is unknown.
  bool wait_events(const std::string& id, size_t& index, std::vector<Json>& out, bool& done, int timeout_ms);

  bool wait_done(const std::string& id, int timeout_ms);  // test helper

 private:
  void worker_loop(int idx);
  void process(const std::string& submission_id, int attempt, int max_attempts, bool& retry);
  void push_event(const std::string& id, Json ev);
  void evict_locked();
  static Json verdict_json(const Submission& s, const Problem* p);
  static Json case_json(const CaseResult& c, bool hidden);

  EngineConfig cfg_;
  std::map<std::string, Problem> problems_;
  std::vector<std::string> problem_order_;
  std::map<std::string, User> users_;
  std::vector<std::string> user_order_;
  std::map<std::string, std::string> sessions_;  // token -> user id
  mutable std::mutex m_;
  mutable std::condition_variable cv_;
  std::map<std::string, std::shared_ptr<Submission>> subs_;
  std::vector<std::string> sub_order_;
  JobQueue<SubmissionJob> queue_;
  RateLimiter limiter_;
  std::vector<std::thread> workers_;
  std::atomic<bool> running_{false};
  std::atomic<int> busy_{0};
  std::atomic<long long> processed_{0}, accepted_{0}, rejected_{0}, latency_sum_{0};
  long long started_at_ = 0;
  long long next_id_ = 0;
  std::string run_tag_;
};

long long now_ms();  // wall clock, epoch ms

}  // namespace aether
