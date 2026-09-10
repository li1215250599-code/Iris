"""Offline regression tests for iris_server: service-side routing, AI paths,
post-processing, and information preservation, driven directly through the
do_POST dispatcher.

Design goals (Codex directive):
  - No network: patch socket.socket.connect AND urllib.request.urlopen so any
    real AI call raises immediately (RuntimeError, not AssertionError — the
    business fallback catches AssertionError as generic Exception and would
    silently degrade to local).
  - No live clinical service: do not start ThreadingHTTPServer; no port 9323.
  - No real patient data: all input notes are hand-crafted representative
    sentences covering the categories Codex required.
  - No changes to iris_server.py: pure monkeypatching at module level.
  - No log pollution: iris_server.log_event is replaced with a test-scoped
    sink; mtime of logs/iris-server.log is verified unchanged before/after.
  - Strict assertions: token-pair checks are CLAUSE-SCOPED, not global,
    so "right-side extracted + left-side maintained" is not confusable with
    "left-side extracted + right-side maintained".
  - Known gaps are reported separately, NOT counted as passing assertions.

The runner exits non-zero on any failure or any network-attempt leak.
"""
from __future__ import annotations

import io
import json
import os
import re
import socket
import sys
import traceback
import urllib.request
from http.client import HTTPMessage
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import iris_server

APP_DIR = REPO_ROOT


# -----------------------------------------------------------------------------
# Sandbox: log capture, network guard, mtime tracking
# -----------------------------------------------------------------------------

_LOG_EVENTS: list[str] = []
_NETWORK_ATTEMPTS: list[str] = []


def _sandbox_log_event(config, message: str) -> None:
    """Replace iris_server.log_event so tests do not touch APP_DIR/logs."""
    _LOG_EVENTS.append(str(message))


def _install_network_guard() -> None:
    """Block real network I/O at both the socket and HTTP-request layers.

    We raise RuntimeError (not AssertionError) because do_POST's except block
    catches generic Exception and would silently fall back to local_generate,
    letting a test accidentally reach the network and still report PASS.
    """

    def denied_socket(self, address):
        _NETWORK_ATTEMPTS.append(f"socket.connect({address})")
        raise RuntimeError(
            f"test attempted socket.connect({address}); "
            "tests must not touch external services"
        )

    def denied_urlopen(url, *args, **kwargs):
        _NETWORK_ATTEMPTS.append(f"urllib.request.urlopen({url})")
        raise RuntimeError(
            f"test attempted urllib.request.urlopen({url}); "
            "tests must not touch external services"
        )

    socket.socket.connect = denied_socket  # type: ignore[assignment]
    urllib.request.urlopen = denied_urlopen  # type: ignore[assignment]


_NETWORK_ORIGINAL: dict[str, object] = {}


def _restore_network_guard() -> None:
    if "socket" in _NETWORK_ORIGINAL:
        socket.socket.connect = _NETWORK_ORIGINAL["socket"]  # type: ignore[assignment]
    if "urlopen" in _NETWORK_ORIGINAL:
        urllib.request.urlopen = _NETWORK_ORIGINAL["urlopen"]  # type: ignore[assignment]


def _capture_network_originals() -> None:
    _NETWORK_ORIGINAL["socket"] = socket.socket.connect
    _NETWORK_ORIGINAL["urlopen"] = urllib.request.urlopen


def _patch_config(**overrides: object) -> None:
    cfg = {
        "ekanya": {
            "url": "http://myourhis.myourchina.cn",
            "profile": str(APP_DIR / ".test-chrome-profile"),
        },
        "logs": str(APP_DIR / "logs"),
        "ai": {"enabled": True, "model": "stub-model", "baseUrl": "https://stub.invalid"},
    }
    cfg.update(overrides)
    iris_server.IrisHandler.config = cfg


def _patch_config_no_ai(**overrides: object) -> None:
    cfg = {
        "ekanya": {
            "url": "http://myourhis.myourchina.cn",
            "profile": str(APP_DIR / ".test-chrome-profile"),
        },
        "logs": str(APP_DIR / "logs"),
        "ai": {"enabled": False, "model": "stub-model", "baseUrl": "https://stub.invalid"},
    }
    cfg.update(overrides)
    iris_server.IrisHandler.config = cfg


# -----------------------------------------------------------------------------
# Fake HTTP plumbing (no live server)
# -----------------------------------------------------------------------------

class FakeRequest:
    """Minimal connection stub: do_POST only reads .rfile and .path."""

    def __init__(self, body: bytes) -> None:
        self.body = body

    def makefile(self, mode: str, bufsize: int = -1):
        return io.BytesIO(self.body)


def post(path: str, payload: dict) -> dict:
    """Invoke do_POST against a hand-built fake connection (no live server)."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    fake_conn = FakeRequest(body)
    handler = iris_server.IrisHandler.__new__(iris_server.IrisHandler)
    handler.request = fake_conn
    handler.client_address = ("127.0.0.1", 0)
    handler.server = ThreadingHTTPServer
    handler.rfile = io.BytesIO(body)
    handler.wfile = io.BytesIO()
    handler.path = path
    handler.command = "POST"
    handler.request_version = "HTTP/1.1"
    handler.requestline = f"POST {path} HTTP/1.1"
    handler.headers = HTTPMessage()
    handler.headers["Content-Length"] = str(len(body))
    handler.config = iris_server.IrisHandler.config
    handler.do_POST()
    out = handler.wfile.getvalue().decode("utf-8")
    i = out.find("\r\n\r\n")
    if i == -1:
        raise AssertionError(f"no HTTP response separator in: {out!r}")
    return json.loads(out[i + 4:])


# -----------------------------------------------------------------------------
# Assertion helpers
# -----------------------------------------------------------------------------

def _fields(rec: dict) -> str:
    return (rec.get("examination") or "") + "\n" + (rec.get("treatment") or "") + "\n" + (rec.get("advice") or "")


def _clauses(text: str) -> list[str]:
    """Split on Chinese/fullwidth punctuation, dropping whitespace-only parts."""
    parts = re.split(r"[，,。；;\n]+", text or "")
    return [p for p in (p.strip() for p in parts) if p]


def _clause_pair(clauses: list[str], left: str, right: str) -> bool:
    """True iff some clause contains BOTH `left` and `right`."""
    for c in clauses:
        if left in c and right in c:
            return True
    return False


def _has_wire_gauge(rec: dict, digit_group: str) -> bool:
    """`1725` is normalized to `0.017 x 0.025 SS`; accept either form.
    Wire-code convention: first two digits -> 0.0XX, last two digits -> 0.0XX."""
    body = _fields(rec)
    if digit_group in body:
        return True
    return f"0.0{digit_group[:2]} x 0.0{digit_group[2:]}" in body


# -----------------------------------------------------------------------------
# Known clinical gaps — informational, NOT counted as passing tests
# -----------------------------------------------------------------------------

KNOWN_GAPS: dict[str, object] = {
    # Value is the CURRENT observed behavior. When the rule is eventually
    # fixed, this entry flips True → False and this report section updates.
    "retainer_gap_adjacent_only": {
        "description": (
            "is_retainer_followup_signal requires 保持器 and 复查/复诊 to be "
            "adjacent. 医生常见表达 '戴保持器3个月，复查' 不匹配 → 走 AI/本地路径 "
            "而非保持器固定模板。"
        ),
        "observed": iris_server.is_retainer_followup_signal("戴保持器3个月，复查"),
        "expected_after_fix": True,
    },
}


# -----------------------------------------------------------------------------
# Service-side routing tests
# -----------------------------------------------------------------------------

def test_retainer_routing_skips_ai():
    """保持器复查必须走固定模板，绝对不调用 call_ai_generate。"""
    _patch_config_no_ai()
    original = iris_server.call_ai_generate
    calls: list = []

    def boom(config, notes):
        calls.append((notes, config))
        raise RuntimeError("保持器复查路径不应调用 call_ai_generate")

    iris_server.call_ai_generate = boom
    try:
        resp = post("/api/generate", {"notes": "保持器复查，继续维持"})
    finally:
        iris_server.call_ai_generate = original

    assert resp["ok"] is True, f"expected ok=True, got {resp}"
    record = resp["record"]
    assert record.get("template") == "retainer-followup", f"template={record.get('template')!r}"
    assert record.get("source") == "retainer-followup-template", f"source={record.get('source')!r}"
    assert "保持器" in record.get("examination", ""), record
    assert "保持" in record.get("plan", ""), record
    assert calls == [], f"call_ai_generate was invoked on retainer path: {calls}"


def test_ai_success_path_stabilizes():
    """AI 成功路径：返回的 record 必须经过 stabilize_record_with_template。"""
    _patch_config()
    canned = {
        "source": "ai",
        "examination": "检查: 13托槽已重粘，17脱落待粘接",
        "treatment": "重粘13托槽，告知",
        "advice": "注意口腔卫生，勿咬硬物，不适随诊。",
        "normalizedNotes": "13托槽已重粘，17脱落",
        "current": "检查：13托槽已重粘，17脱落\n处置：重粘13托槽，告知",
        "nextPlan": "",
        "flags": [],
    }
    original = iris_server.call_ai_generate
    calls: list = []

    def fake_ai(config, notes):
        calls.append(notes)
        return dict(canned)

    iris_server.call_ai_generate = fake_ai
    try:
        resp = post("/api/generate", {"notes": "13托槽已重粘，17脱落待粘接"})
    finally:
        iris_server.call_ai_generate = original

    assert resp["ok"] is True, resp
    record = resp["record"]
    assert calls == ["13托槽已重粘，17脱落待粘接"], f"AI not called with notes: {calls}"
    assert record.get("source") == "ai+template", f"source={record.get('source')!r}"
    assert "13" in record.get("current", ""), record
    assert "17" in record.get("current", ""), record
    assert "托槽" in record.get("current", ""), record
    assert "13" in record.get("examination", ""), record
    assert "17" in record.get("examination", ""), record


def test_ai_failure_falls_back_to_local():
    """AI 抛异常时必须回退到 local_generate，不吞掉临床信息。"""
    _patch_config()
    original = iris_server.call_ai_generate

    def boom(config, notes):
        raise RuntimeError("stubbed network failure")

    iris_server.call_ai_generate = boom
    try:
        resp = post("/api/generate", {"notes": "换1725的不锈钢丝，继续二类牵引"})
    finally:
        iris_server.call_ai_generate = original

    assert resp["ok"] is True, resp
    record = resp["record"]
    assert record.get("source") == "local-template", f"expected local fallback, got {record.get('source')!r}"
    assert _has_wire_gauge(record, "1725"), f"1725 gauge lost: {record}"
    assert ("II" in _fields(record) or "Ⅱ" in _fields(record) or "二类" in _fields(record)), f"elastic class lost: {record}"


def test_ai_disabled_falls_back_to_local():
    """config.ai.enabled=False 必须直接回退到 local_generate，不发网络请求。"""
    _patch_config_no_ai()
    resp = post("/api/generate", {"notes": "口卫一般，换1725的不锈钢丝"})

    assert resp["ok"] is True, resp
    record = resp["record"]
    assert record.get("source") == "local-template", f"expected local-template, got {record.get('source')!r}"
    assert _has_wire_gauge(record, "1725"), f"1725 gauge lost: {record}"


def test_ai_empty_record_falls_back_to_local():
    """AI 返回全空字段（examination/treatment/advice 均空）时，
    do_POST 必须回退到 local_generate 补充实质内容，不能只返回 AI 的空壳。"""
    _patch_config()
    original = iris_server.call_ai_generate

    def fake_ai_empty(config, notes):
        return {
            "source": "ai",
            "examination": "",
            "treatment": "",
            "advice": "",
            "normalizedNotes": "",
            "current": "",
            "nextPlan": "",
            "flags": [],
        }

    iris_server.call_ai_generate = fake_ai_empty
    try:
        resp = post("/api/generate", {"notes": "口卫一般，换1725的不锈钢丝"})
    finally:
        iris_server.call_ai_generate = original

    assert resp["ok"] is True, resp
    record = resp["record"]
    body = _fields(record)
    # At least one substantive field must be non-empty after fallback.
    assert (record.get("examination") or record.get("treatment") or record.get("advice")), (
        f"AI returned all-empty fields and no local fallback filled them: {record}"
    )
    # And the local fallback must preserve the input's key facts.
    assert _has_wire_gauge(record, "1725"), f"1725 gauge lost after AI-empty fallback: {record}"


def test_ai_partial_record_merged_with_local():
    """AI 只给部分字段时，stabilize_record_with_template 后关键实体仍需保留。"""
    _patch_config()
    original = iris_server.call_ai_generate

    def fake_ai_partial(config, notes):
        return {
            "source": "ai",
            "examination": "13托槽重粘",
            "treatment": "",
            "advice": "",
            "normalizedNotes": "",
            "current": "",
            "nextPlan": "",
            "flags": [],
        }

    iris_server.call_ai_generate = fake_ai_partial
    try:
        resp = post("/api/generate", {"notes": "13托槽已重粘，17脱落待粘接"})
    finally:
        iris_server.call_ai_generate = original

    assert resp["ok"] is True, resp
    record = resp["record"]
    body = _fields(record)
    # The AI's 13 entity must survive merge.
    assert "13" in body, f"13 entity lost after partial AI merge: {record}"
    # The second entity (17) from the input must also be preserved somewhere
    # in the stabilized record (either from AI template merge or local fallback).
    assert "17" in body, f"17 entity lost after partial AI merge: {record}"


# -----------------------------------------------------------------------------
# Empty-input tests (do_POST rejects empty notes)
# -----------------------------------------------------------------------------

def test_generate_empty_notes_returns_error():
    _patch_config()
    resp = post("/api/generate", {"notes": ""})
    assert resp["ok"] is False, f"empty notes must not return ok=True, got {resp}"
    assert "请先输入复诊要点" in resp.get("message", ""), resp


def test_generate_missing_notes_key_returns_error():
    _patch_config()
    resp = post("/api/generate", {})
    assert resp["ok"] is False, f"missing notes key must return ok=False, got {resp}"


def test_generate_whitespace_only_returns_error():
    _patch_config()
    resp = post("/api/generate", {"notes": "   \n\t "})
    assert resp["ok"] is False, f"whitespace-only notes must return ok=False, got {resp}"


# -----------------------------------------------------------------------------
# local_generate rule regression tests
# -----------------------------------------------------------------------------

def test_local_retainer_signal_adjacent_only():
    """Current routing behavior: 保持器 + 复查/复诊 必须相邻（或倒序）。

    Known gap: '戴保持器3个月，复查' is NOT routed to the retainer template
    because 保持器 and 复查 are not adjacent. See KNOWN_GAPS report in main().
    This test only verifies the ADJACENT cases still work.
    """
    assert iris_server.is_retainer_followup_signal("保持器复查")
    assert iris_server.is_retainer_followup_signal("复查保持器")
    assert not iris_server.is_retainer_followup_signal("戴保持器")


def test_local_wire_gauge_preserved():
    rec = iris_server.local_generate("换1725的不锈钢丝，继续二类牵引")
    assert _has_wire_gauge(rec, "1725"), f"1725 gauge (or 0.017 x 0.025 SS) lost: {rec}"


def test_local_class_elastic_preserved():
    rec = iris_server.local_generate("换II类牵引，继续佩戴")
    assert any(tok in _fields(rec) for tok in ("II类", "Ⅱ类", "二类")), f"II class lost/renormalized: {rec}"


def test_local_aligner_preserved():
    rec = iris_server.local_generate("第3副隐形牙套，佩戴良好")
    body = _fields(rec)
    assert "隐形牙套" in body, f"aligner token lost: {rec}"
    assert ("第3副" in body or "3副" in body), f"aligner number lost: {rec}"


def test_local_anchor_screw_side_action_pairing():
    """'右侧已拔、左侧维持' 必须两侧都保留，且侧别与动作在同一子句内配对。"""
    rec = iris_server.local_generate("上颌右侧种植钉已拔，左侧继续维持")
    body = _fields(rec)
    clauses = _clauses(body)

    # Both sides must be present.
    assert any("右侧" in c for c in clauses), f"right side lost: {rec}"
    assert any("左侧" in c for c in clauses), f"left side lost: {rec}"
    assert any(any(tok in c for c in clauses) for tok in ("种植钉", "支抗钉", "种植体钉", "支抗")), (
        f"anchor screw token lost: {rec}"
    )

    # Correspondence: 右侧 must be in the same clause as an extraction word,
    # 左侧 must be in the same clause as a maintenance word. This is the key
    # assertion Codex flagged: a global "contains" check would pass a reversed
    # record, but a clause-scoped check does not.
    extraction_words = ("拔除", "已拔", "拔", "取出")
    maintain_words = ("维持", "继续维持", "继续使用", "继续")
    assert any(
        _clause_pair(clauses, "右侧", w) for w in extraction_words
    ), f"right side is not paired with an extraction action in its own clause: clauses={clauses}"
    assert any(
        _clause_pair(clauses, "左侧", w) for w in maintain_words
    ), f"left side is not paired with a maintenance action in its own clause: clauses={clauses}"


def test_local_anchor_side_action_pairing_reversal_fails():
    """配对检查必须能识别左右颠倒的错误输出——直接验证 `_clause_pair` 逻辑。

    这直接回应 Codex 用 `"左侧已拔，右侧继续维持，拔除完成"` 找出的假通过：
    颠倒后 `右侧↔维持` 在同一子句（配对成立），但 `右侧↔拔` 不在同一子句，
    所以"右侧已拔"这一正确关联会缺失，测试必须判失败。
    """
    reversed_body = "左侧已拔，右侧继续维持，拔除完成"
    clauses = _clauses(reversed_body)

    # The reversed output still has both sides and both actions globally:
    assert "右侧" in reversed_body and "左侧" in reversed_body
    assert any(w in reversed_body for w in ("已拔", "拔除"))
    assert any(w in reversed_body for w in ("维持", "继续维持"))

    # But the CORRECT pairing (right side ↔ extraction) is MISSING:
    assert not any(_clause_pair(clauses, "右侧", w) for w in ("已拔", "拔除", "拔", "取出")), (
        "clause-scoped pairing falsely accepted right-side-extracted in a reversed record"
    )
    # And the correct pairing (left side ↔ maintenance) is also MISSING:
    assert not any(_clause_pair(clauses, "左侧", w) for w in ("维持", "继续维持", "继续使用", "继续")), (
        "clause-scoped pairing falsely accepted left-side-maintained in a reversed record"
    )

    # Sanity: the same helper DOES find the correct pairing in an un-reversed record.
    correct_body = "右侧已拔，左侧继续维持"
    correct_clauses = _clauses(correct_body)
    assert any(_clause_pair(correct_clauses, "右侧", w) for w in ("已拔", "拔除", "拔", "取出"))
    assert any(_clause_pair(correct_clauses, "左侧", w) for w in ("维持", "继续维持", "继续使用", "继续"))


def test_local_anchor_two_count_preserved():
    rec = iris_server.local_generate("上颌右侧两颗种植钉都已拔除")
    body = _fields(rec)
    clauses = _clauses(body)
    assert any("右侧" in c for c in clauses), f"right side lost: {rec}"
    assert any(("两颗" in c or "2颗" in c) for c in clauses), f"count 'two' lost: {rec}"
    assert any(("拔除" in c or "拔" in c) for c in clauses), f"'removed' token lost: {rec}"
    # 右侧 should be paired (in the same clause) with 两颗/2颗.
    assert any(_clause_pair(clauses, "右侧", "两颗") or _clause_pair(clauses, "右侧", "2颗") for c in clauses), (
        f"right side not paired with count in its own clause: clauses={clauses}"
    )


def test_local_negation_modifies_wearing():
    """否定必须修饰'佩戴'行为——不能只出现'未'和'牵引'就当作通过。"""
    rec = iris_server.local_generate("患者未佩戴II类牵引皮筋")
    body = _fields(rec)
    assert "牵引" in body, f"'traction' token lost: {rec}"
    negators = ("未佩戴", "未按要求", "未使用", "未戴")
    assert any(tok in body for tok in negators), f"negation does not modify wearing behavior: {rec}"


def test_local_ambiguous_side_neither_side_added():
    """'上颌第一前磨牙' 未指明侧别——绝不能补出'左侧'或'右侧'（任一单独出现也算补）。"""
    rec = iris_server.local_generate("上颌第一前磨牙")
    body = _fields(rec)
    assert "左侧" not in body, f"left side invented: {rec}"
    assert "右侧" not in body, f"right side invented: {rec}"
    assert "左边" not in body, f"left side (variant) invented: {rec}"
    assert "右边" not in body, f"right side (variant) invented: {rec}"


def test_local_debonded_tooth_preserved():
    rec = iris_server.local_generate("17脱落")
    body = _fields(rec)
    assert "17" in body, f"tooth 17 lost: {rec}"
    assert "脱落" in body, f"'debonded' token lost: {rec}"


# -----------------------------------------------------------------------------
# Sandbox install / restore
# -----------------------------------------------------------------------------

_SBOX_ORIGINAL_LOG = iris_server.log_event  # module-level placeholder; overwritten by _install_test_sandbox


def _install_test_sandbox() -> int:
    """Install log capture + network guard; return mtime of the real log file."""
    global _SBOX_ORIGINAL_LOG
    _capture_network_originals()
    _install_network_guard()
    _SBOX_ORIGINAL_LOG = iris_server.log_event
    iris_server.log_event = _sandbox_log_event
    real_log = APP_DIR / "logs" / "iris-server.log"
    return real_log.stat().st_mtime_ns if real_log.exists() else 0


def _restore_sandbox() -> None:
    global _SBOX_ORIGINAL_LOG
    iris_server.log_event = _SBOX_ORIGINAL_LOG
    _restore_network_guard()


# -----------------------------------------------------------------------------
# Runner
# -----------------------------------------------------------------------------

def main() -> int:
    log_mtime_before = _install_test_sandbox()
    exit_code = 0
    try:
        tests = [v for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
        print(f"Running {len(tests)} service-side regression tests")
        passed = 0
        failed = 0
        for test in tests:
            _NETWORK_ATTEMPTS.clear()
            try:
                test()
            except AssertionError as exc:
                failed += 1
                print(f"FAIL  {test.__name__}")
                print(f"      {exc}")
                continue
            except Exception:
                failed += 1
                print(f"ERROR {test.__name__}")
                traceback.print_exc()
                continue
            # Per-test network-attempt assertion (Codex directive #4)
            if _NETWORK_ATTEMPTS:
                failed += 1
                print(f"FAIL  {test.__name__}  (network leak)")
                for attempt in _NETWORK_ATTEMPTS:
                    print(f"      {attempt}")
                continue
            passed += 1
            print(f"PASS  {test.__name__}")
        print(f"---\n{passed} passed, {failed} failed of {len(tests)}")

        # Log-sandbox verification (built-in mtime comparison)
        real_log = APP_DIR / "logs" / "iris-server.log"
        log_mtime_after = real_log.stat().st_mtime_ns if real_log.exists() else 0
        if log_mtime_before == log_mtime_after:
            print(f"---\nLog sandbox: OK — logs/iris-server.log untouched "
                  f"(mtime unchanged), {len(_LOG_EVENTS)} log events captured in-memory")
        else:
            print(f"---\nLog sandbox: LEAK — logs/iris-server.log mtime changed "
                  f"({log_mtime_before} → {log_mtime_after})")
            failed += 1
            exit_code = 1

        # Network-attempt summary
        print(f"Network attempts (must be 0): {len(_NETWORK_ATTEMPTS)}")

        # Known gaps report — informational, not counted as PASS or FAIL
        print("=== KNOWN GAPS (待裁决, not counted as test results) ===")
        for name, gap in KNOWN_GAPS.items():
            status = "UNRESOLVED" if gap.get("observed") != gap.get("expected_after_fix") else "RESOLVED"
            print(f"  [{status}] {name}")
            print(f"    {gap.get('description', '')}")
        print("=== end KNOWN GAPS ===")

        if failed:
            print(f"{failed} test(s) failed; verification FAILED")
            return 1
        print("all tests passed")
        return 0
    finally:
        _restore_sandbox()


if __name__ == "__main__":
    sys.exit(main())
