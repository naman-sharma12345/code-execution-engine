#include "aether/server.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstring>

namespace aether {
namespace {

std::string lower(std::string s) {
  for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

const char* reason(int code) {
  switch (code) {
    case 200: return "OK"; case 201: return "Created"; case 204: return "No Content";
    case 400: return "Bad Request"; case 404: return "Not Found"; case 405: return "Method Not Allowed";
    case 408: return "Request Timeout"; case 411: return "Length Required"; case 413: return "Payload Too Large";
    case 429: return "Too Many Requests"; case 431: return "Request Header Fields Too Large";
    case 501: return "Not Implemented"; case 503: return "Service Unavailable"; default: return "Error";
  }
}

bool write_all(int fd, const char* p, size_t n) {
  while (n > 0) {
    ssize_t w = send(fd, p, n, MSG_NOSIGNAL);
    if (w > 0) { p += w; n -= static_cast<size_t>(w); }
    else if (w < 0 && errno == EINTR) continue;
    else if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      struct pollfd pf{fd, POLLOUT, 0};
      if (poll(&pf, 1, 5000) <= 0) return false;
    } else return false;
  }
  return true;
}

struct Response {
  int code = 200;
  std::string body;
  std::string content_type = "application/json";
  std::vector<std::pair<std::string, std::string>> headers;
};

Response json_resp(int code, const Json& j) {
  Response r; r.code = code; r.body = j.dump(); return r;
}
Response error_resp(int code, const std::string& msg) {
  Json j = Json::object(); j["error"] = msg; return json_resp(code, j);
}

std::string head_for(const Response& r, const std::string& cors, bool with_len, size_t len) {
  std::string h = "HTTP/1.1 " + std::to_string(r.code) + " " + reason(r.code) + "\r\n";
  h += "Content-Type: " + r.content_type + "\r\n";
  if (with_len) h += "Content-Length: " + std::to_string(len) + "\r\n";
  h += "Connection: close\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n";
  if (!cors.empty()) {
    h += "Access-Control-Allow-Origin: " + cors + "\r\n";
    h += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n";
  }
  for (auto& [k, v] : r.headers) h += k + ": " + v + "\r\n";
  return h + "\r\n";
}

std::vector<std::string> split_path(const std::string& p) {
  std::vector<std::string> out;
  size_t i = 0;
  while (i < p.size()) {
    if (p[i] == '/') { i++; continue; }
    size_t e = p.find('/', i);
    out.push_back(p.substr(i, e == std::string::npos ? std::string::npos : e - i));
    if (e == std::string::npos) break;
    i = e;
  }
  return out;
}

Json arr_of(const std::vector<Json>& v) { return Json(JsonArray(v.begin(), v.end())); }
Json wrap(const char* key, Json v) { Json j = Json::object(); j[key] = std::move(v); return j; }

}  // namespace

std::string url_decode(const std::string& s) {
  std::string o;
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '%' && i + 2 < s.size() + 0 && std::isxdigit(static_cast<unsigned char>(s[i + 1])) && std::isxdigit(static_cast<unsigned char>(s[i + 2]))) {
      o += static_cast<char>(std::stoi(s.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else if (s[i] == '+') o += ' ';
    else o += s[i];
  }
  return o;
}

std::string HttpRequest::header(const std::string& name) const {
  for (auto& [k, v] : headers) if (k == name) return v;
  return "";
}

std::string HttpRequest::query_param(const std::string& name) const {
  size_t i = 0;
  while (i <= query.size()) {
    size_t e = query.find('&', i);
    std::string kv = query.substr(i, e == std::string::npos ? std::string::npos : e - i);
    size_t eq = kv.find('=');
    if (url_decode(kv.substr(0, eq)) == name) return eq == std::string::npos ? "" : url_decode(kv.substr(eq + 1));
    if (e == std::string::npos) break;
    i = e + 1;
  }
  return "";
}

std::string parse_request_head(const std::string& head, HttpRequest& out) {
  size_t le = head.find("\r\n");
  if (le == std::string::npos) return "malformed request line";
  std::string line = head.substr(0, le);
  size_t s1 = line.find(' '), s2 = line.rfind(' ');
  if (s1 == std::string::npos || s2 == s1) return "malformed request line";
  out.method = line.substr(0, s1);
  std::string target = line.substr(s1 + 1, s2 - s1 - 1);
  std::string ver = line.substr(s2 + 1);
  if (ver != "HTTP/1.1" && ver != "HTTP/1.0") return "unsupported HTTP version";
  if (out.method.empty() || !std::all_of(out.method.begin(), out.method.end(), [](unsigned char c) { return std::isupper(c); }))
    return "bad method";
  if (target.empty() || target[0] != '/') return "bad request target";
  for (unsigned char c : target) if (c < 0x21 || c == 0x7f) return "bad request target";
  size_t q = target.find('?');
  out.path = url_decode(q == std::string::npos ? target : target.substr(0, q));
  out.query = q == std::string::npos ? "" : target.substr(q + 1);
  if (out.path.find('\0') != std::string::npos) return "bad path";
  size_t pos = le + 2;
  while (pos < head.size()) {
    size_t e = head.find("\r\n", pos);
    if (e == std::string::npos) e = head.size();
    if (e == pos) break;
    std::string h = head.substr(pos, e - pos);
    size_t c = h.find(':');
    if (c == std::string::npos || c == 0) return "malformed header";
    std::string name = lower(h.substr(0, c));
    if (name.find(' ') != std::string::npos) return "malformed header";
    size_t vs = c + 1;
    while (vs < h.size() && (h[vs] == ' ' || h[vs] == '\t')) vs++;
    size_t ve = h.size();
    while (ve > vs && (h[ve - 1] == ' ' || h[ve - 1] == '\t')) ve--;
    out.headers.push_back({name, h.substr(vs, ve - vs)});
    pos = e + 2;
  }
  return "";
}

Server::Server(Engine& e, ServerConfig cfg) : engine_(e), cfg_(std::move(cfg)) {}
Server::~Server() { stop(); }

bool Server::start(std::string& error) {
  listen_fd_ = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listen_fd_ < 0) { error = std::string("socket: ") + std::strerror(errno); return false; }
  int one = 1;
  setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_port = htons(static_cast<uint16_t>(cfg_.port));
  if (inet_pton(AF_INET, cfg_.host.c_str(), &a.sin_addr) != 1) { error = "bad host: " + cfg_.host; close(listen_fd_); return false; }
  if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || listen(listen_fd_, 128) != 0) {
    error = std::string("bind/listen: ") + std::strerror(errno);
    close(listen_fd_);
    listen_fd_ = -1;
    return false;
  }
  socklen_t len = sizeof a;
  getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&a), &len);
  port_ = ntohs(a.sin_port);
  running_ = true;
  accept_thread_ = std::thread([this] { accept_loop(); });
  return true;
}

void Server::stop() {
  if (!running_.exchange(false)) return;
  if (accept_thread_.joinable()) accept_thread_.join();
  if (listen_fd_ >= 0) { close(listen_fd_); listen_fd_ = -1; }
  // Wait briefly for in-flight handlers (SSE loops observe running_).
  for (int i = 0; i < 100 && conns_ > 0; i++) usleep(20000);
}

void Server::accept_loop() {
  while (running_) {
    struct pollfd pf{listen_fd_, POLLIN, 0};
    if (poll(&pf, 1, 100) <= 0) continue;
    int fd = accept4(listen_fd_, nullptr, nullptr, SOCK_CLOEXEC);
    if (fd < 0) continue;
    if (conns_ >= cfg_.max_connections) {
      Response r = error_resp(503, "Server busy");
      std::string h = head_for(r, cfg_.cors_origin, true, r.body.size()) + r.body;
      write_all(fd, h.data(), h.size());
      close(fd);
      continue;
    }
    conns_++;
    std::thread([this, fd] { handle(fd); close(fd); conns_--; }).detach();
  }
}

void Server::handle(int fd) {
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  std::string buf;
  size_t head_end = std::string::npos;
  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(cfg_.read_timeout_ms);
  auto send_resp = [&](const Response& r) {
    std::string h = head_for(r, cfg_.cors_origin, true, r.body.size());
    h += r.body;
    write_all(fd, h.data(), h.size());
  };
  char tmp[8192];
  auto read_more = [&]() -> int {  // 1 ok, 0 closed, -1 timeout
    for (;;) {
      auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
      if (left <= 0) return -1;
      struct pollfd pf{fd, POLLIN, 0};
      int pr = poll(&pf, 1, static_cast<int>(std::min<long long>(left, 1000)));
      if (pr < 0 && errno != EINTR) return 0;
      if (pr <= 0) { if (!running_) return 0; continue; }
      ssize_t n = recv(fd, tmp, sizeof tmp, 0);
      if (n > 0) { buf.append(tmp, static_cast<size_t>(n)); return 1; }
      if (n == 0) return 0;
      if (errno == EINTR || errno == EAGAIN) continue;
      return 0;
    }
  };
  while ((head_end = buf.find("\r\n\r\n")) == std::string::npos) {
    if (buf.size() > cfg_.max_header_bytes) { send_resp(error_resp(431, "Headers too large")); return; }
    int r = read_more();
    if (r < 0) { send_resp(error_resp(408, "Request timeout")); return; }
    if (r == 0) return;
  }
  if (head_end > cfg_.max_header_bytes) { send_resp(error_resp(431, "Headers too large")); return; }
  HttpRequest req;
  std::string perr = parse_request_head(buf.substr(0, head_end + 2), req);
  if (!perr.empty()) { send_resp(error_resp(400, perr)); return; }
  if (!req.header("transfer-encoding").empty()) { send_resp(error_resp(501, "Chunked bodies not supported")); return; }
  size_t clen = 0;
  std::string cl = req.header("content-length");
  if (!cl.empty()) {
    if (cl.size() > 12 || !std::all_of(cl.begin(), cl.end(), [](unsigned char c) { return std::isdigit(c); })) {
      send_resp(error_resp(400, "Bad Content-Length")); return;
    }
    clen = std::stoull(cl);
    if (clen > cfg_.max_body_bytes) { send_resp(error_resp(413, "Body too large")); return; }
  } else if (req.method == "POST") { send_resp(error_resp(411, "Content-Length required")); return; }
  size_t body_start = head_end + 4;
  while (buf.size() - body_start < clen) {
    int r = read_more();
    if (r < 0) { send_resp(error_resp(408, "Request timeout")); return; }
    if (r == 0) return;
  }
  req.body = buf.substr(body_start, clen);

  // ---- routing ----
  if (req.method == "OPTIONS") { Response r; r.code = 204; send_resp(r); return; }
  auto seg = split_path(req.path);
  bool is_get = req.method == "GET" || req.method == "HEAD";
  auto method_not_allowed = [&] { Response r = error_resp(405, "Method not allowed"); send_resp(r); };

  if (seg.empty() || (seg.size() == 1 && seg[0] == "health")) {
    Json j = Json::object(); j["status"] = "ok"; j["engine"] = "aetherrun-cpp";
    send_resp(json_resp(200, j)); return;
  }
  if (seg[0] != "api") { send_resp(error_resp(404, "Not found")); return; }

  if (seg.size() == 2 && seg[1] == "problems") {
    if (!is_get) return method_not_allowed();
    send_resp(json_resp(200, wrap("problems", arr_of(engine_.list_problems())))); return;
  }
  if (seg.size() == 3 && seg[1] == "problems") {
    if (!is_get) return method_not_allowed();
    Json j;
    if (!engine_.problem_json(seg[2], j)) { send_resp(error_resp(404, "Problem not found")); return; }
    send_resp(json_resp(200, wrap("problem", std::move(j)))); return;
  }
  if (seg.size() == 2 && seg[1] == "submissions") {
    if (req.method == "GET" || req.method == "HEAD") {
      long long lim = 20;
      std::string ls = req.query_param("limit");
      if (!ls.empty()) {
        if (ls.size() > 6 || !std::all_of(ls.begin(), ls.end(), [](unsigned char c) { return std::isdigit(c); })) { send_resp(error_resp(400, "Bad limit")); return; }
        lim = std::clamp<long long>(std::stoll(ls), 1, 100);
      }
      send_resp(json_resp(200, wrap("submissions", arr_of(engine_.list_submissions(static_cast<size_t>(lim)))))); return;
    }
    if (req.method != "POST") return method_not_allowed();
    Json body;
    try { body = Json::parse(req.body); } catch (const JsonError& e) { send_resp(error_resp(400, std::string("Invalid JSON: ") + e.what())); return; }
    if (!body.is_object()) { send_resp(error_resp(400, "Body must be a JSON object")); return; }
    for (const char* f : {"problemId", "language", "code"}) {
      auto* v = body.find(f);
      if (!v || !v->is_string() || v->as_string().empty()) { send_resp(error_resp(400, "Missing required fields: problemId, language, code")); return; }
    }
    User user;
    if (!engine_.resolve_user(req.header("authorization"), req.query_param("userId"), user)) { send_resp(error_resp(404, "User not found")); return; }
    SubmitResult sr = engine_.submit({body.str_or("problemId"), user.id, body.str_or("language"), body.str_or("code")});
    switch (sr.kind) {
      case SubmitResult::Ok: {
        Json j = Json::object();
        j["submissionId"] = sr.id; j["priority"] = sr.priority; j["tier"] = sr.tier;
        j["streamUrl"] = "/api/submissions/" + sr.id + "/stream";
        j["message"] = "Submission enqueued. Open the stream URL for real-time updates.";
        send_resp(json_resp(201, j)); return;
      }
      case SubmitResult::BadRequest: send_resp(error_resp(400, sr.error)); return;
      case SubmitResult::NotFound: send_resp(error_resp(404, sr.error)); return;
      case SubmitResult::RateLimited: {
        Json b = Json::object();
        b["error"] = sr.error;
        b["message"] = "Too many submissions. Try again in " + std::to_string((sr.retry_after_ms + 999) / 1000) + "s.";
        b["retryAfterMs"] = sr.retry_after_ms;
        Response r = json_resp(429, b);
        r.headers.push_back({"Retry-After", std::to_string((sr.retry_after_ms + 999) / 1000)});
        send_resp(r); return;
      }
    }
  }
  if (seg.size() == 3 && seg[1] == "submissions") {
    if (!is_get) return method_not_allowed();
    Json j;
    if (!engine_.submission_json(seg[2], j)) { send_resp(error_resp(404, "Submission not found")); return; }
    send_resp(json_resp(200, wrap("submission", std::move(j)))); return;
  }
  if (seg.size() == 4 && seg[1] == "submissions" && seg[3] == "stream") {
    if (!is_get) return method_not_allowed();
    Json probe;
    if (!engine_.submission_json(seg[2], probe)) { send_resp(error_resp(404, "Submission not found")); return; }
    Response r; r.content_type = "text/event-stream"; r.headers.push_back({"X-Accel-Buffering", "no"});
    std::string h = head_for(r, cfg_.cors_origin, false, 0);
    if (!write_all(fd, h.data(), h.size())) return;
    size_t idx = 0;
    auto last_beat = std::chrono::steady_clock::now();
    while (running_) {
      std::vector<Json> evs;
      bool done = false;
      if (!engine_.wait_events(seg[2], idx, evs, done, 1000)) return;
      for (auto& e : evs) {
        std::string line = "data: " + e.dump() + "\n\n";
        if (!write_all(fd, line.data(), line.size())) return;
      }
      if (done) { static const char* d = "event: done\ndata: {}\n\n"; write_all(fd, d, std::strlen(d)); return; }
      auto now = std::chrono::steady_clock::now();
      if (!evs.empty()) last_beat = now;
      else if (now - last_beat > std::chrono::seconds(15)) {
        static const char* hb = ": heartbeat\n\n";
        if (!write_all(fd, hb, std::strlen(hb))) return;
        last_beat = now;
      }
      // detect client disconnect
      struct pollfd pf{fd, POLLIN | POLLRDHUP, 0};
      if (poll(&pf, 1, 0) > 0 && (pf.revents & (POLLHUP | POLLERR | POLLRDHUP))) return;
    }
    return;
  }
  if (seg.size() == 2 && seg[1] == "stats") {
    if (!is_get) return method_not_allowed();
    send_resp(json_resp(200, engine_.stats())); return;
  }
  if (seg.size() == 2 && seg[1] == "leaderboard") {
    if (!is_get) return method_not_allowed();
    send_resp(json_resp(200, wrap("leaderboard", arr_of(engine_.leaderboard(100))))); return;
  }
  if (seg.size() == 2 && seg[1] == "users") {
    if (is_get) { send_resp(json_resp(200, wrap("users", arr_of(engine_.list_users())))); return; }
    if (req.method != "POST") return method_not_allowed();
    Json body;
    try { body = Json::parse(req.body); } catch (const JsonError&) { send_resp(error_resp(400, "Invalid JSON")); return; }
    auto* u = body.find("username");
    if (!u || !u->is_string() || u->as_string().empty()) { send_resp(error_resp(400, "username is required")); return; }
    Json session;
    if (!engine_.login(u->as_string(), session)) { send_resp(error_resp(404, "User not found")); return; }
    send_resp(json_resp(200, session)); return;
  }
  send_resp(error_resp(404, "Not found"));
}

}  // namespace aether
