// Sliding-window rate limiter. Thread-safe; clock is injectable for tests.
#pragma once
#include <chrono>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>

namespace aether {

struct RateDecision {
  bool allowed;
  int remaining;
  long long retry_after_ms;
};

class RateLimiter {
 public:
  using Clock = std::function<long long()>;  // milliseconds, monotonic
  RateLimiter(int limit = 5, long long window_ms = 60000, Clock clock = nullptr)
      : limit_(limit), window_ms_(window_ms), clock_(clock ? std::move(clock) : default_clock) {}

  RateDecision hit(const std::string& key) {
    std::lock_guard<std::mutex> g(m_);
    long long now = clock_();
    auto& q = store_[key];
    while (!q.empty() && q.front() <= now - window_ms_) q.pop_front();
    if (static_cast<int>(q.size()) >= limit_) return {false, 0, q.front() + window_ms_ - now};
    q.push_back(now);
    return {true, limit_ - static_cast<int>(q.size()), 0};
  }
  size_t peek(const std::string& key) {
    std::lock_guard<std::mutex> g(m_);
    auto it = store_.find(key);
    return it == store_.end() ? 0 : it->second.size();
  }
  // Drops idle keys so memory stays bounded.
  void cleanup() {
    std::lock_guard<std::mutex> g(m_);
    long long now = clock_();
    for (auto it = store_.begin(); it != store_.end();) {
      auto& q = it->second;
      while (!q.empty() && q.front() <= now - window_ms_) q.pop_front();
      it = q.empty() ? store_.erase(it) : std::next(it);
    }
  }
  size_t keys() { std::lock_guard<std::mutex> g(m_); return store_.size(); }
  int limit() const { return limit_; }

 private:
  static long long default_clock() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch()).count();
  }
  int limit_;
  long long window_ms_;
  Clock clock_;
  std::mutex m_;
  std::unordered_map<std::string, std::deque<long long>> store_;
};

}  // namespace aether
