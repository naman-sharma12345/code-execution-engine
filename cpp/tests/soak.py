#!/usr/bin/env python3
"""Cross-language soak test: mixed good/bad submissions in all four languages under concurrent load.

Starts the engine itself (default build/aetherrun), fires N submissions from T client threads, checks every
verdict against what the program should produce, then checks the server did not leak threads, fds, memory,
child processes or work directories.  Usage: python3 tests/soak.py [N] [THREADS] [path-to-aetherrun]
Run from the cpp/ directory (the engine reads data/problems.json relative to it).
"""
import json, os, random, signal, subprocess, sys, threading, time, urllib.request, glob

N = int(sys.argv[1]) if len(sys.argv) > 1 else 200
T = int(sys.argv[2]) if len(sys.argv) > 2 else 8
BIN = sys.argv[3] if len(sys.argv) > 3 else "build/aetherrun"
PORT = 3790 + os.getpid() % 100
B = f"http://127.0.0.1:{PORT}"

SUM = {  # correct A+B per language
 "python": "a,b=map(int,input().split())\nprint(a+b)\n",
 "javascript": "const l=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(l[0]+l[1]);",
 "cpp": "#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b;}",
 "java": "import java.util.*;public class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}",
}
WRONG = {
 "python": "print(0)\n", "javascript": "console.log(0);",
 "cpp": "#include <iostream>\nint main(){std::cout<<0;}",
 "java": "public class Main{public static void main(String[] x){System.out.println(0);}}",
}
COMPILE_ERR = {"cpp": "int main( {", "java": "class Main { void x( }"}
RTE = {
 "python": "raise SystemExit(3)\n", "javascript": "process.exit(3);",
 "cpp": "int main(){return 3;}",
 "java": "public class Main{public static void main(String[] x){System.exit(3);}}",
}
TLE = {
 "python": "while True: pass\n", "javascript": "while(true){}",
 "cpp": "int main(){for(;;){}}",
 "java": "public class Main{public static void main(String[] x){while(true){}}}",
}
FLOOD = {  # unbounded output must be cut off, not buffered forever
 "python": "while True: print('x'*1000)\n", "javascript": "for(;;)console.log('x'.repeat(1000));",
 "cpp": "#include <cstdio>\nint main(){for(;;)puts(\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\");}",
 "java": "public class Main{public static void main(String[] x){while(true)System.out.println(\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\");}}",
}
HOG = {  # memory hog must be killed
 "python": "x=[]\nwhile True: x.append(bytearray(10**7))\n",
 "cpp": "#include <cstdlib>\n#include <cstring>\nint main(){for(;;){char*p=(char*)malloc(1<<24);if(p)memset(p,1,1<<24);}}",
}

def build_cases():
    cases = []
    for lang in SUM:
        cases += [(lang, SUM[lang], {"ACCEPTED"})] * 6
        cases += [(lang, WRONG[lang], {"WRONG_ANSWER"})] * 2
        cases += [(lang, RTE[lang], {"RTE"})] * 2
        cases += [(lang, TLE[lang], {"TLE"})]
        cases += [(lang, FLOOD[lang], {"RTE", "WRONG_ANSWER", "TLE"})]
    for lang, c in COMPILE_ERR.items(): cases += [(lang, c, {"FAILED"})] * 2
    for lang, c in HOG.items(): cases += [(lang, c, {"MLE", "RTE", "TLE"})]
    random.seed(7)
    out = []
    while len(out) < N: out += random.sample(cases, len(cases))
    return out[:N]

def call(method, path, body=None, tok=None):
    h = {"content-type": "application/json"}
    if tok: h["authorization"] = "Bearer " + tok
    r = urllib.request.Request(B + path, json.dumps(body).encode() if body is not None else None, h, method=method)
    return json.load(urllib.request.urlopen(r, timeout=30))

def proc_stats(pid):
    st = {}
    for l in open(f"/proc/{pid}/status"):
        k, _, v = l.partition(":"); st[k] = v.strip()
    try: fds = len(os.listdir(f"/proc/{pid}/fd"))
    except PermissionError: fds = -1  # the server is non-dumpable on purpose, so /proc/<pid>/fd is hidden from us
    return int(st["Threads"]), int(st["VmRSS"].split()[0]), fds

def fmt(n): return "hidden" if n < 0 else str(n)

def children(pid):
    try: return subprocess.check_output(["pgrep", "-P", str(pid)]).split()
    except subprocess.CalledProcessError: return []

def main():
    env = dict(os.environ, AETHER_PORT=str(PORT), AETHER_RATE_LIMIT="1000000", AETHER_WORKERS="4")
    srv = subprocess.Popen([BIN], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: call("GET", "/health"); break
        except Exception: time.sleep(0.2)
    tok = call("POST", "/api/users", {"username": "demo_pro"})["token"]
    base = proc_stats(srv.pid)
    cases = build_cases()
    results, lock, idx = [], threading.Lock(), [0]
    def worker():
        while True:
            with lock:
                i = idx[0]; idx[0] += 1
            if i >= len(cases): return
            lang, code, ok = cases[i]
            try:
                sid = call("POST", "/api/submissions", {"problemId": "prob_sum", "language": lang, "code": code}, tok)["submissionId"]
                t0 = time.time()
                while time.time() - t0 < 120:
                    s = call("GET", "/api/submissions/" + sid, tok=tok); s = s.get("submission", s)
                    if s["status"] not in ("PENDING", "COMPILING", "RUNNING"): break
                    time.sleep(0.05)
                res = (lang, s["status"], ok, time.time() - t0)
            except Exception as e:
                res = (lang, "ERROR:" + repr(e), ok, 0)
            with lock: results.append(res)
    t0 = time.time()
    ths = [threading.Thread(target=worker) for _ in range(T)]
    [t.start() for t in ths]; [t.join() for t in ths]
    wall = time.time() - t0
    time.sleep(3)  # let the server settle
    after = proc_stats(srv.pid)
    kids = children(srv.pid)
    srv.send_signal(signal.SIGTERM)
    try: srv.wait(timeout=20); exit_code = srv.returncode
    except subprocess.TimeoutExpired: srv.kill(); exit_code = "killed"
    bad = [r for r in results if r[1] not in r[2]]
    left = [d for d in glob.glob("/tmp/aether-work-*/*")] if os.access("/tmp", os.R_OK) else []
    by = {}
    for lang, st, ok, dt in results: by.setdefault(lang, []).append(dt)
    print(f"submissions: {len(results)}/{N}  wall: {wall:.1f}s  throughput: {len(results)/wall:.1f}/s  clients: {T}")
    for lang, d in sorted(by.items()):
        d.sort(); print(f"  {lang:10s} n={len(d):3d}  p50={d[len(d)//2]*1000:6.0f}ms  p95={d[int(len(d)*.95)-1]*1000:6.0f}ms  max={d[-1]*1000:6.0f}ms")
    print(f"wrong verdicts: {len(bad)}")
    for r in bad[:10]: print("   ", r[0], "got", r[1], "expected one of", sorted(r[2]))
    print(f"threads {base[0]} -> {after[0]}   rss {base[1]//1024}MB -> {after[1]//1024}MB   fds {fmt(base[2])} -> {fmt(after[2])}")
    print(f"leftover child processes: {len(kids)}   leftover work dirs: {len(left)}   exit on SIGTERM: {exit_code}")
    fail = bool(bad) or len(results) != N or after[0] > base[0] + 2 or (after[2] >= 0 and after[2] > base[2] + 3) or kids or exit_code != 0
    print("SOAK", "FAILED" if fail else "PASSED")
    sys.exit(1 if fail else 0)

main()
