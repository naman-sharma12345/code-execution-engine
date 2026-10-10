#include "aether/judge.hpp"
#include "testing.hpp"

using namespace aether;

static Problem sum_problem(int tl = 2000, int ml = 256) {
  Problem p;
  p.id = "sum"; p.title = "A+B"; p.time_limit_ms = tl; p.cpu_time_limit_ms = tl; p.memory_limit_mb = ml;
  p.tests = {{"t0", "3 5\n", "8\n", false, 0}, {"t1", "-10 20\n", "10\n", false, 1},
             {"t2", "1000000000 1000000000\n", "2000000000\n", true, 2}};
  return p;
}

static const char* CPP_OK = "#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b;}";  // no trailing newline on purpose
static const char* PY_OK = "a,b=map(int,input().split())\nprint(a+b)\n";
static const char* JS_OK = "const l=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(l[0]+l[1]);";
static const char* JAVA_OK = "import java.util.*;public class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}";

TEST(judge_accepts_all_languages) {
  auto p = sum_problem(4000);
  struct { Language l; const char* code; } cases[] = {{Language::Cpp, CPP_OK}, {Language::Python, PY_OK},
                                                       {Language::JavaScript, JS_OK}, {Language::Java, JAVA_OK}};
  for (auto& c : cases) {
    Verdict v = judge(p, c.l, c.code);
    if (v.status != Status::Accepted) std::cerr << "  " << to_string(c.l) << ": " << to_string(v.status) << " " << v.error_message << v.compile_output << "\n";
    CHECK(v.status == Status::Accepted);
    CHECK_EQ(v.passed, 3);
    CHECK_EQ(v.cases.size(), 3u);
  }
}
TEST(judge_wrong_answer_runs_all_cases) {
  Verdict v = judge(sum_problem(), Language::Python, "a,b=map(int,input().split())\nprint(a+b if a>0 else 0)\n");
  CHECK(v.status == Status::WrongAnswer);
  CHECK_EQ(v.passed, 2);
  CHECK(v.cases[1].status == CaseStatus::WrongAnswer);
  CHECK(v.cases[2].status == CaseStatus::Accepted);
}
TEST(judge_compile_error) {
  Verdict v = judge(sum_problem(), Language::Cpp, "int main( { return 0; }");
  CHECK(v.status == Status::Failed);
  CHECK_EQ(v.error_message, std::string("Compilation failed"));
  CHECK(v.compile_output.find("error") != std::string::npos);
  CHECK_EQ(v.cases.size(), 3u);
  for (auto& c : v.cases) CHECK(c.status == CaseStatus::Skipped);
  Verdict j = judge(sum_problem(), Language::Java, "class Main { void x( }");
  CHECK(j.status == Status::Failed);
}
TEST(judge_runtime_error_skips_rest) {
  Verdict v = judge(sum_problem(), Language::Cpp, "#include <cstdlib>\nint main(){ int* p=nullptr; *p=1; }");
  CHECK(v.status == Status::RuntimeError);
  CHECK(v.cases[0].status == CaseStatus::RuntimeError);
  CHECK(v.cases[1].status == CaseStatus::Skipped);
  CHECK(v.cases[0].stderr_text.find("signal") != std::string::npos);
  Verdict e = judge(sum_problem(), Language::Python, "import sys\nsys.exit(3)\n");
  CHECK(e.status == Status::RuntimeError);
  CHECK_EQ(e.cases[0].exit_code, 3);
}
TEST(judge_time_limit) {
  Verdict v = judge(sum_problem(300), Language::Cpp, "int main(){ volatile long x=0; for(;;) x++; }");
  CHECK(v.status == Status::TimeLimit);
  CHECK(v.time_ms >= 300 && v.time_ms < 1500);
  Verdict p = judge(sum_problem(300), Language::Python, "while True: pass\n");
  CHECK(p.status == Status::TimeLimit);
}
TEST(judge_memory_limit) {
  Verdict v = judge(sum_problem(5000, 64), Language::Cpp,
                    "#include <cstring>\n#include <cstdlib>\nint main(){ volatile char* p=(char*)malloc(300u<<20); for(unsigned i=0;i<(300u<<20);i+=4096) p[i]=1; return p[4096]==1?0:1; }");
  CHECK(v.status == Status::MemoryLimit);
  Verdict py = judge(sum_problem(5000, 64), Language::Python, "x = bytearray(300*1024*1024)\nprint(len(x))\n");
  CHECK(py.status == Status::MemoryLimit);
}
TEST(judge_infinite_output_is_runtime_error) {
  Verdict v = judge(sum_problem(5000), Language::Python, "while True:\n    print('x'*1000)\n");
  CHECK(v.status == Status::RuntimeError);
  CHECK(v.cases[0].stderr_text.find("output limit") != std::string::npos);
  CHECK(v.cases[0].stdout_text.size() <= (1u << 20));
}
TEST(judge_ignoring_stdin_is_fine) {
  Verdict v = judge(sum_problem(), Language::Cpp, "#include <cstdio>\nint main(){ printf(\"8\\n\"); }");
  CHECK(v.status == Status::WrongAnswer);
  CHECK(v.cases[0].status == CaseStatus::Accepted);
}
TEST(judge_events_stream_in_order) {
  std::vector<std::string> ev;
  judge(sum_problem(), Language::Python, PY_OK, [&](const JudgeEvent& e) {
    switch (e.type) {
      case JudgeEvent::StatusChange: ev.push_back(std::string("status:") + to_string(e.status)); break;
      case JudgeEvent::Case: ev.push_back("case"); break;
      default: break;
    }
  });
  std::vector<std::string> want = {"status:COMPILING", "status:RUNNING", "case", "case", "case"};
  CHECK(ev == want);
}
TEST(judge_empty_problem_is_infra_failure) {
  Problem p; p.id = "x";
  CHECK(judge(p, Language::Cpp, "int main(){}").status == Status::Failed);
}
TEST(judge_respects_test_order_field) {
  Problem p = sum_problem();
  p.tests[0].order = 5; p.tests[1].order = 1; p.tests[2].order = 3;
  Verdict v = judge(p, Language::Python, PY_OK);
  CHECK_EQ(v.cases[0].test_case_id, std::string("t1"));
  CHECK_EQ(v.cases[2].test_case_id, std::string("t0"));
}
TEST(judge_unicode_and_binary_output_do_not_break) {
  Verdict v = judge(sum_problem(), Language::Python, "import sys\nsys.stdout.buffer.write(b'\\xff\\xfe\\x00bad')\n");
  CHECK(v.status == Status::WrongAnswer);
}
TEST(judge_sandbox_hides_server_environment) {
  setenv("AETHER_API_SECRET", "s3cr3t", 1);
  Problem p = sum_problem(); p.tests = {{"t", "", "NONE\n", false, 0}};
  Verdict v = judge(p, Language::Python, "import os\nprint(os.environ.get('AETHER_API_SECRET','NONE'))\n");
  CHECK(v.status == Status::Accepted);
}

TEST(judge_script_syntax_errors_are_runtime_errors) {
  Verdict p = judge(sum_problem(), Language::Python, "def (:\n");
  CHECK(p.status == Status::RuntimeError);
  Verdict j = judge(sum_problem(), Language::JavaScript, "console.log(;");
  CHECK(j.status == Status::RuntimeError);
}
TEST(judge_crlf_and_trailing_space_output_accepted) {
  Verdict v = judge(sum_problem(), Language::Python, "a,b=map(int,input().split())\nprint(str(a+b)+'  \\r')\n");
  if (v.status != Status::Accepted) std::cerr << "  " << to_string(v.status) << "\n";
  CHECK(v.status == Status::Accepted);
}
TEST(judge_empty_code_does_not_crash) {
  Verdict v = judge(sum_problem(), Language::Python, "");
  CHECK(v.status == Status::WrongAnswer || v.status == Status::RuntimeError || v.status == Status::Failed);
}

TEST(judge_programs_cannot_list_other_work_dirs) {
  Problem p = sum_problem(4000);
  p.tests = {{"t0", "1 2\n", "x\n", false, 0}};
  const char* code = "import os\nd=os.path.dirname(os.getcwd())\ntry:\n print('LISTED', os.listdir(d))\nexcept Exception as e:\n print('DENIED')\n";
  Verdict v = judge(p, Language::Python, code);
  CHECK_EQ(v.cases.size(), 1u);
  if (v.cases[0].stdout_text.find("DENIED") == std::string::npos) std::cerr << "  out=" << v.cases[0].stdout_text << " err=" << v.cases[0].stderr_text << "\n";
  CHECK(v.cases[0].stdout_text.find("DENIED") != std::string::npos);
}
