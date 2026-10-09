// Minimal, strict, dependency-free JSON value/parser/serializer (RFC 8259).
#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace aether {

class Json;
using JsonArray = std::vector<Json>;
using JsonObject = std::map<std::string, Json>;

struct JsonError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

class Json {
 public:
  using Null = std::nullptr_t;
  Json() : v_(nullptr) {}
  Json(std::nullptr_t) : v_(nullptr) {}
  Json(bool b) : v_(b) {}
  Json(int i) : v_(static_cast<double>(i)) {}
  Json(long i) : v_(static_cast<double>(i)) {}
  Json(long long i) : v_(static_cast<double>(i)) {}
  Json(unsigned long i) : v_(static_cast<double>(i)) {}
  Json(double d) : v_(d) {}
  Json(const char* s) : v_(std::string(s)) {}
  Json(std::string s) : v_(std::move(s)) {}
  Json(JsonArray a) : v_(std::move(a)) {}
  Json(JsonObject o) : v_(std::move(o)) {}

  static Json object() { return Json(JsonObject{}); }
  static Json array() { return Json(JsonArray{}); }

  bool is_null() const { return std::holds_alternative<Null>(v_); }
  bool is_bool() const { return std::holds_alternative<bool>(v_); }
  bool is_number() const { return std::holds_alternative<double>(v_); }
  bool is_string() const { return std::holds_alternative<std::string>(v_); }
  bool is_array() const { return std::holds_alternative<JsonArray>(v_); }
  bool is_object() const { return std::holds_alternative<JsonObject>(v_); }

  bool as_bool() const { return get<bool>("bool"); }
  double as_number() const { return get<double>("number"); }
  long long as_int() const { return static_cast<long long>(get<double>("number")); }
  const std::string& as_string() const { return get<std::string>("string"); }
  const JsonArray& as_array() const { return get<JsonArray>("array"); }
  const JsonObject& as_object() const { return get<JsonObject>("object"); }
  JsonArray& arr() { return get_mut<JsonArray>("array"); }
  JsonObject& obj() { return get_mut<JsonObject>("object"); }

  // Object helpers; return nullptr / defaults when absent or wrong type.
  const Json* find(const std::string& k) const {
    if (!is_object()) return nullptr;
    auto& o = std::get<JsonObject>(v_);
    auto it = o.find(k);
    return it == o.end() ? nullptr : &it->second;
  }
  std::string str_or(const std::string& k, const std::string& d = "") const {
    auto* j = find(k);
    return j && j->is_string() ? j->as_string() : d;
  }
  long long int_or(const std::string& k, long long d = 0) const {
    auto* j = find(k);
    return j && j->is_number() ? j->as_int() : d;
  }
  bool bool_or(const std::string& k, bool d = false) const {
    auto* j = find(k);
    return j && j->is_bool() ? j->as_bool() : d;
  }
  Json& operator[](const std::string& k) {
    if (is_null()) v_ = JsonObject{};
    return obj()[k];
  }
  void push(Json j) {
    if (is_null()) v_ = JsonArray{};
    arr().push_back(std::move(j));
  }

  std::string dump() const;
  static Json parse(const std::string& text);  // throws JsonError

 private:
  template <class T> const T& get(const char* n) const {
    if (auto* p = std::get_if<T>(&v_)) return *p;
    throw JsonError(std::string("json: not a ") + n);
  }
  template <class T> T& get_mut(const char* n) {
    if (auto* p = std::get_if<T>(&v_)) return *p;
    throw JsonError(std::string("json: not a ") + n);
  }
  std::variant<Null, bool, double, std::string, JsonArray, JsonObject> v_;
};

}  // namespace aether
