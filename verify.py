"""Unified offline verification entrypoint for the Iris repo.

Runs the same checks locally and on GitHub Actions:
  1. Python syntax check  (python -m py_compile iris_server.py)
  2. Repository JSON validity (terms.json, chrome-extension/manifest.json)
  3. Extension JS syntax check (node --check content.js background.js)
  4. Service-side offline regression (tests/service_regression.py)

Any failure returns a non-zero exit code. No network access, no live service
startup, no external AI calls, no login state, no real E看牙 page access.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
HEAD = "\033[1m\033[36m\033[0m"


def run(cmd: list[str], label: str, *, quiet: bool = False) -> int:
    print(f"{HEAD}{label}\033[0m", flush=True)
    print(f"  $ {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        env=os.environ.copy(),
        stdout=subprocess.PIPE if quiet else None,
        stderr=subprocess.PIPE if quiet else None,
    )
    if quiet:
        # only surface stderr/stdout on failure
        if proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", "replace")
            stdout = (proc.stdout or b"").decode("utf-8", "replace")
            tail = "\n".join((stderr + "\n" + stdout).strip().splitlines()[-15:])
            if tail:
                print(f"  ---- output tail ----\n{tail}", flush=True)
    print(f"  exit={proc.returncode}", flush=True)
    return proc.returncode


def main() -> int:
    failures: list[tuple[str, int]] = []
    py = sys.executable  # pin to the interpreter running verify.py, not PATH lookup

    # 1. Python syntax
    rc = run([py, "-m", "py_compile", "iris_server.py"], "Python syntax: iris_server.py", quiet=True)
    if rc != 0:
        failures.append(("python -m py_compile iris_server.py", rc))

    # 2. JSON validity
    for path in ("terms.json", "chrome-extension/manifest.json"):
        rc = run([py, "-m", "json.tool", path], f"JSON validity: {path}", quiet=True)
        if rc != 0:
            failures.append((f"python -m json.tool {path}", rc))

    # 3. Extension JS syntax (Node required)
    for path in ("chrome-extension/content.js", "chrome-extension/background.js"):
        rc = run(["node", "--check", path], f"JS syntax: {path}", quiet=True)
        if rc != 0:
            failures.append((f"node --check {path}", rc))

    # 4. Service-side offline regression
    rc = run([py, "tests/service_regression.py"], "Service-side offline regression")
    if rc != 0:
        failures.append(("python tests/service_regression.py", rc))

    print()
    print(f"{HEAD}=== Verification summary ===\033[0m")
    if not failures:
        print(f"{PASS} all checks passed")
        return 0
    print(f"{FAIL} {len(failures)} check(s) failed:")
    for label, code in failures:
        print(f"  - {label}  (exit={code})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
