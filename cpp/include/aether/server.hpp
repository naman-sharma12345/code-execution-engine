// Small HTTP/1.1 server (Connection: close) exposing the AetherRun REST + SSE API.
#pragma once
#include <atomic>
#include <string>
#include <thread>

#include "aether/engine.hpp"

namespace aether {

struct ServerConfig {
  std::string host = "127.0.0.1";
  int port = 3001;               // 0 = pick a free port (see Server::port())
  int max_connections = 256;
  size_t max_header_bytes = 16 * 1024;
  size_t max_body_bytes = 256 * 1024;
  int read_timeout_ms = 10000;
  std::string cors_origin = "*";
};

struct HttpRequest {
  std::string method, path, query, body;
  std::vector<std::pair<std::string, std::string>> headers;  // lower-cased names
  std::string header(const std::string& name) const;
  std::string query_param(const std::string& name) const;
};

// Parses a request head ("GET /x?y=1 HTTP/1.1\r\n...\r\n\r\n"). Returns "" on success or an error text.
std::string parse_request_head(const std::string& head, HttpRequest& out);
std::string url_decode(const std::string& s);

class Server {
 public:
  Server(Engine& engine, ServerConfig cfg = {});
  ~Server();
  bool start(std::string& error);  // bind+listen+accept thread
  void stop();
  int port() const { return port_; }

 private:
  void accept_loop();
  void handle(int fd);
  Engine& engine_;
  ServerConfig cfg_;
  int listen_fd_ = -1;
  int port_ = 0;
  std::atomic<bool> running_{false};
  std::atomic<int> conns_{0};
  std::thread accept_thread_;
};

}  // namespace aether
