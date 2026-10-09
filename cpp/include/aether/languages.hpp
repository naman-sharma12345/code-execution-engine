// Language runners (Abstract Factory): how to compile and run each language.
#pragma once
#include <string>
#include <vector>

#include "aether/sandbox.hpp"
#include "aether/types.hpp"

namespace aether {

struct CompileResult {
  bool success = false;
  std::string output;  // combined stdout+stderr, capped
  bool unavailable = false;  // compiler could not be started (host problem, not a user error)
};

class LanguageRunner {
 public:
  virtual ~LanguageRunner() = default;
  virtual Language language() const = 0;
  virtual const char* source_file() const = 0;
  virtual bool requires_compile() const = 0;
  // Compile in work_dir. Default: no-op success.
  virtual CompileResult compile(const std::string& work_dir) const;
  // Fully-specified run for one test case.
  virtual RunSpec make_run(const std::string& work_dir, const Problem& p, const std::string& stdin_data) const = 0;

 protected:
  static std::vector<std::string> base_env(const std::string& work_dir);
  CompileResult run_compiler(const std::string& work_dir, std::vector<std::string> argv) const;
};

const LanguageRunner& get_runner(Language l);

// Writes source into work_dir under the runner's fixed filename. Returns false on I/O error.
bool write_source(const LanguageRunner& r, const std::string& work_dir, const std::string& code);

}  // namespace aether
