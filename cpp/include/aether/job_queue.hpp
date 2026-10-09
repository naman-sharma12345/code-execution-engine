// Priority queue with retries (exponential backoff) and a dead-letter list.
// Higher priority first; FIFO within a priority. Thread-safe; blocking pop supported.
#pragma once
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace aether {

template <class Payload>
struct Job {
  std::string id;
  Payload payload;
  int priority = 0;
  int attempts = 0;
  int max_attempts = 3;
  long long seq = 0;
  long long next_retry_at = 0;
};

struct QueueStats { size_t waiting, delayed, active, failed, completed; };

template <class Payload>
class JobQueue {
 public:
  using Clock = std::function<long long()>;
  explicit JobQueue(Clock clock = nullptr, long long backoff_base_ms = 1000, long long backoff_max_ms = 30000)
      : clock_(clock ? std::move(clock) : default_clock), base_(backoff_base_ms), max_(backoff_max_ms) {}

  std::string add(Payload p, int priority, int max_attempts = 3) {
    std::lock_guard<std::mutex> g(m_);
    Job<Payload> j;
    j.id = "job_" + std::to_string(++id_seq_);
    j.payload = std::move(p);
    j.priority = priority;
    j.max_attempts = std::max(1, max_attempts);
    j.seq = ++seq_;
    waiting_.push_back(std::move(j));
    std::string id = waiting_.back().id;
    cv_.notify_one();
    return id;
  }

  // Non-blocking. Promotes due retries first.
  std::optional<Job<Payload>> poll() {
    std::lock_guard<std::mutex> g(m_);
    return poll_locked();
  }

  // Blocks up to timeout_ms for a job; returns nullopt on timeout/close.
  std::optional<Job<Payload>> wait_poll(long long timeout_ms) {
    std::unique_lock<std::mutex> lk(m_);
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    for (;;) {
      if (auto j = poll_locked()) return j;
      if (closed_) return std::nullopt;
      // Wake early for delayed jobs that become due.
      auto until = deadline;
      if (!delayed_.empty()) {
        long long soonest = delayed_.front().next_retry_at;
        for (auto& d : delayed_) soonest = std::min(soonest, d.next_retry_at);
        long long wait = std::max<long long>(1, soonest - clock_());
        until = std::min(deadline, std::chrono::steady_clock::now() + std::chrono::milliseconds(wait));
      }
      if (cv_.wait_until(lk, until) == std::cv_status::timeout && std::chrono::steady_clock::now() >= deadline) {
        return poll_locked();
      }
    }
  }

  void complete(const std::string& id) {
    std::lock_guard<std::mutex> g(m_);
    auto it = find_active(id);
    if (it == active_.end()) return;
    active_.erase(it);
    if (++completed_ > 1000000000LL) completed_ = 0;
  }

  // Returns true if the job was scheduled for retry, false if dead-lettered or unknown.
  bool fail(const std::string& id, const std::string& error) {
    std::lock_guard<std::mutex> g(m_);
    auto it = find_active(id);
    if (it == active_.end()) return false;
    Job<Payload> j = std::move(*it);
    active_.erase(it);
    last_error_ = error;
    if (j.attempts < j.max_attempts) {
      long long backoff = base_;
      for (int i = 1; i < j.attempts && backoff < max_; i++) backoff *= 2;
      backoff = std::min(backoff, max_);
      j.next_retry_at = clock_() + backoff;
      delayed_.push_back(std::move(j));
      cv_.notify_all();
      return true;
    }
    dead_.push_back(std::move(j));
    return false;
  }

  bool requeue_dead(const std::string& id) {
    std::lock_guard<std::mutex> g(m_);
    auto it = std::find_if(dead_.begin(), dead_.end(), [&](auto& j) { return j.id == id; });
    if (it == dead_.end()) return false;
    Job<Payload> j = std::move(*it);
    dead_.erase(it);
    j.attempts = 0;
    j.next_retry_at = 0;
    j.seq = ++seq_;
    waiting_.push_back(std::move(j));
    cv_.notify_one();
    return true;
  }

  std::vector<Job<Payload>> dead_letters() {
    std::lock_guard<std::mutex> g(m_);
    return dead_;
  }
  QueueStats stats() {
    std::lock_guard<std::mutex> g(m_);
    return {waiting_.size(), delayed_.size(), active_.size(), dead_.size(), static_cast<size_t>(completed_)};
  }
  void close() {
    std::lock_guard<std::mutex> g(m_);
    closed_ = true;
    cv_.notify_all();
  }

 private:
  static long long default_clock() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch()).count();
  }
  typename std::vector<Job<Payload>>::iterator find_active(const std::string& id) {
    return std::find_if(active_.begin(), active_.end(), [&](auto& j) { return j.id == id; });
  }
  std::optional<Job<Payload>> poll_locked() {
    long long now = clock_();
    for (auto it = delayed_.begin(); it != delayed_.end();) {
      if (it->next_retry_at <= now) { waiting_.push_back(std::move(*it)); it = delayed_.erase(it); }
      else ++it;
    }
    if (waiting_.empty()) return std::nullopt;
    auto best = waiting_.begin();
    for (auto it = waiting_.begin(); it != waiting_.end(); ++it)
      if (it->priority > best->priority || (it->priority == best->priority && it->seq < best->seq)) best = it;
    Job<Payload> j = std::move(*best);
    waiting_.erase(best);
    j.attempts += 1;
    active_.push_back(j);
    return j;
  }

  Clock clock_;
  long long base_, max_;
  std::mutex m_;
  std::condition_variable cv_;
  std::vector<Job<Payload>> waiting_, delayed_, active_, dead_;
  long long seq_ = 0, id_seq_ = 0, completed_ = 0;
  bool closed_ = false;
  std::string last_error_;
};

}  // namespace aether
