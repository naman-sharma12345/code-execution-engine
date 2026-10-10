#include "aether/json.hpp"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace aether {
namespace {

void escape_into(std::string& out, const std::string& s) {
  out += '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  out += '"';
}

// Replace invalid UTF-8 with U+FFFD so output is always valid JSON text.
std::string sanitize_utf8(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  size_t i = 0, n = s.size();
  while (i < n) {
    unsigned char c = s[i];
    int len = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 0;
    bool ok = len > 0 && i + len <= n;
    if (ok) {
      for (int k = 1; k < len; k++) if ((static_cast<unsigned char>(s[i + k]) & 0xC0) != 0x80) ok = false;
    }
    if (ok && len == 2 && c < 0xC2) ok = false;
    if (ok && len == 3) {
      unsigned cp = ((c & 0xF) << 12) | ((s[i + 1] & 0x3F) << 6) | (s[i + 2] & 0x3F);
      if (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF)) ok = false;
    }
    if (ok && len == 4) {
      unsigned cp = ((c & 0x7) << 18) | ((s[i + 1] & 0x3F) << 12) | ((s[i + 2] & 0x3F) << 6) | (s[i + 3] & 0x3F);
      if (cp < 0x10000 || cp > 0x10FFFF) ok = false;
    }
    if (ok) { out.append(s, i, len); i += len; }
    else { out += "\xEF\xBF\xBD"; i++; }
  }
  return out;
}

void dump_into(std::string& out, const Json& j) {
  if (j.is_null()) out += "null";
  else if (j.is_bool()) out += j.as_bool() ? "true" : "false";
  else if (j.is_number()) {
    double d = j.as_number();
    if (!std::isfinite(d)) { out += "null"; return; }
    if (d == std::floor(d) && std::fabs(d) < 9e15) {
      out += std::to_string(static_cast<long long>(d));
    } else {
      char buf[40];
      std::snprintf(buf, sizeof buf, "%.17g", d);
      out += buf;
    }
  } else if (j.is_string()) escape_into(out, sanitize_utf8(j.as_string()));
  else if (j.is_array()) {
    out += '[';
    bool first = true;
    for (auto& e : j.as_array()) { if (!first) out += ','; first = false; dump_into(out, e); }
    out += ']';
  } else {
    out += '{';
    bool first = true;
    for (auto& [k, v] : j.as_object()) {
      if (!first) out += ',';
      first = false;
      escape_into(out, sanitize_utf8(k));
      out += ':';
      dump_into(out, v);
    }
    out += '}';
  }
}

class Parser {
 public:
  explicit Parser(const std::string& s) : s_(s) {}
  Json run() {
    ws();
    Json v = value(0);
    ws();
    if (p_ != s_.size()) fail("trailing characters");
    return v;
  }

 private:
  const std::string& s_;
  size_t p_ = 0;
  [[noreturn]] void fail(const std::string& m) { throw JsonError("json: " + m + " at offset " + std::to_string(p_)); }
  void ws() { while (p_ < s_.size() && (s_[p_] == ' ' || s_[p_] == '\t' || s_[p_] == '\n' || s_[p_] == '\r')) p_++; }
  char peek() { if (p_ >= s_.size()) fail("unexpected end"); return s_[p_]; }
  void expect(const char* lit) {
    for (const char* c = lit; *c; c++) { if (p_ >= s_.size() || s_[p_] != *c) fail("bad literal"); p_++; }
  }
  Json value(int depth) {
    if (depth > 128) fail("nesting too deep");
    char c = peek();
    if (c == '{') return object(depth);
    if (c == '[') return array(depth);
    if (c == '"') return Json(string());
    if (c == 't') { expect("true"); return Json(true); }
    if (c == 'f') { expect("false"); return Json(false); }
    if (c == 'n') { expect("null"); return Json(nullptr); }
    return number();
  }
  Json object(int depth) {
    p_++; ws();
    JsonObject o;
    if (peek() == '}') { p_++; return Json(std::move(o)); }
    for (;;) {
      ws();
      if (peek() != '"') fail("expected string key");
      std::string k = string();
      ws();
      if (peek() != ':') fail("expected ':'");
      p_++; ws();
      o[k] = value(depth + 1);
      ws();
      char c = peek();
      if (c == ',') { p_++; continue; }
      if (c == '}') { p_++; break; }
      fail("expected ',' or '}'");
    }
    return Json(std::move(o));
  }
  Json array(int depth) {
    p_++; ws();
    JsonArray a;
    if (peek() == ']') { p_++; return Json(std::move(a)); }
    for (;;) {
      ws();
      a.push_back(value(depth + 1));
      ws();
      char c = peek();
      if (c == ',') { p_++; continue; }
      if (c == ']') { p_++; break; }
      fail("expected ',' or ']'");
    }
    return Json(std::move(a));
  }
  unsigned hex4() {
    if (p_ + 4 > s_.size()) fail("bad \\u escape");
    unsigned v = 0;
    for (int i = 0; i < 4; i++) {
      char c = s_[p_++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0';
      else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
      else fail("bad hex digit");
    }
    return v;
  }
  static void utf8(std::string& o, unsigned cp) {
    if (cp < 0x80) o += static_cast<char>(cp);
    else if (cp < 0x800) { o += static_cast<char>(0xC0 | (cp >> 6)); o += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { o += static_cast<char>(0xE0 | (cp >> 12)); o += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); o += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { o += static_cast<char>(0xF0 | (cp >> 18)); o += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); o += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); o += static_cast<char>(0x80 | (cp & 0x3F)); }
  }
  std::string string() {
    p_++;  // opening quote
    std::string out;
    for (;;) {
      if (p_ >= s_.size()) fail("unterminated string");
      unsigned char c = s_[p_++];
      if (c == '"') break;
      if (c < 0x20) fail("control character in string");
      if (c != '\\') { out += static_cast<char>(c); continue; }
      if (p_ >= s_.size()) fail("bad escape");
      char e = s_[p_++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          unsigned cp = hex4();
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            if (p_ + 1 < s_.size() && s_[p_] == '\\' && s_[p_ + 1] == 'u') {
              p_ += 2;
              unsigned lo = hex4();
              if (lo < 0xDC00 || lo > 0xDFFF) fail("bad surrogate pair");
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            } else fail("lone high surrogate");
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) fail("lone low surrogate");
          utf8(out, cp);
          break;
        }
        default: fail("bad escape");
      }
    }
    return out;
  }
  Json number() {
    size_t st = p_;
    if (p_ < s_.size() && s_[p_] == '-') p_++;
    if (p_ >= s_.size()) fail("bad number");
    if (s_[p_] == '0') p_++;
    else if (s_[p_] >= '1' && s_[p_] <= '9') while (p_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[p_]))) p_++;
    else fail("unexpected character");
    if (p_ < s_.size() && s_[p_] == '.') {
      p_++;
      size_t d = p_;
      while (p_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[p_]))) p_++;
      if (d == p_) fail("bad fraction");
    }
    if (p_ < s_.size() && (s_[p_] == 'e' || s_[p_] == 'E')) {
      p_++;
      if (p_ < s_.size() && (s_[p_] == '+' || s_[p_] == '-')) p_++;
      size_t d = p_;
      while (p_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[p_]))) p_++;
      if (d == p_) fail("bad exponent");
    }
    return Json(std::strtod(s_.substr(st, p_ - st).c_str(), nullptr));
  }
};

}  // namespace

std::string Json::dump() const {
  std::string out;
  dump_into(out, *this);
  return out;
}

Json Json::parse(const std::string& text) { return Parser(text).run(); }

}  // namespace aether
