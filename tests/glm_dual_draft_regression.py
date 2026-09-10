"""Offline regression tests for Phase 02 GLM dual-draft behavior.

No live server, external network, credentials, patient data, or logs are used.
"""
from __future__ import annotations

import io
import json
import os
import sys
from http.client import HTTPMessage
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import iris_server


def post(path: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler = iris_server.IrisHandler.__new__(iris_server.IrisHandler)
    handler.request = object()
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
    handler.config = {"ai": {"enabled": False}}
    handler.do_POST()
    raw = handler.wfile.getvalue().decode("utf-8")
    return json.loads(raw.split("\r\n\r\n", 1)[1])


def valid_payload(notes: str) -> dict:
    return {
        "facts": {
            "findings": [
                {
                    "raw": "未见托槽脱落",
                    "record_field": "examination",
                    "polarity": "negative",
                    "confidence": "explicit",
                    "jaw": "unspecified",
                    "tooth": "unspecified",
                }
            ],
            "procedures": [
                {
                    "raw": "今天未处理",
                    "record_field": "treatment",
                    "polarity": "negative",
                    "confidence": "explicit",
                    "jaw": "unspecified",
                    "tooth": "unspecified",
                }
            ],
            "instructions": [],
        },
        "uncertainties": [],
        "safety_flags": [],
        "source_summary": notes,
    }


def test_validator_accepts_traceable_negative_facts():
    notes = "未见托槽脱落，今天未处理"
    validated = iris_server.validate_glm_facts(notes, valid_payload(notes))
    candidate = iris_server.render_glm_candidate(validated)
    assert "未见托槽脱落" in candidate["examination"]
    assert "今天未处理" in candidate["treatment"]


def test_validator_rejects_untraceable_fact():
    notes = "未见托槽脱落，今天未处理"
    payload = valid_payload(notes)
    payload["facts"]["findings"][0]["raw"] = "17托槽脱落"
    try:
        iris_server.validate_glm_facts(notes, payload)
    except iris_server.GlmDraftError as exc:
        assert exc.status == "validation_failed"
    else:
        raise AssertionError("untraceable fact was accepted")


def _reject(name, payload):
    try:
        iris_server.validate_glm_facts("未见托槽脱落，今天未处理，1725的不锈钢丝", payload)
    except iris_server.GlmDraftError as exc:
        assert exc.status == "validation_failed"
    else:
        raise AssertionError(f"{name} was accepted")


def test_validator_derives_polarity_from_traceable_negation():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"][0]["polarity"] = "positive"
    validated = iris_server.validate_glm_facts("未见托槽脱落，今天未处理", payload)
    assert validated["facts"]["findings"][0]["polarity"] == "negative"


def test_validator_rejects_invented_tooth_number():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"][0]["tooth"] = "17"
    payload["facts"]["findings"][0]["jaw"] = "upper"
    _reject("invented tooth", payload)


def test_validator_rejects_invented_jaw():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"][0]["jaw"] = "lower"
    _reject("invented jaw", payload)


def test_validator_rejects_material_without_traceable_spec():
    payload = valid_payload("未见托槽脱落，今天未处理，1725的不锈钢丝")
    payload["facts"]["findings"][0]["raw"] = "不锈钢丝"
    _reject("material without spec", payload)


def test_validator_accepts_material_with_traceable_spec():
    notes = "换1725的不锈钢丝"
    payload = {
        "facts": {
            "findings": [],
            "procedures": [{"raw": "换1725的不锈钢丝", "record_field": "treatment", "polarity": "positive", "confidence": "explicit", "jaw": "unspecified", "tooth": "unspecified"}],
            "instructions": [],
        },
        "uncertainties": [],
        "safety_flags": [],
        "source_summary": "",
    }
    assert iris_server.validate_glm_facts(notes, payload) is not None


def test_validator_rejects_wrong_record_field():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"][0]["record_field"] = "plan"
    _reject("wrong record field", payload)


def test_validator_rejects_unknown_enum():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"][0]["confidence"] = "certain"
    _reject("unknown enum", payload)


def test_validator_rejects_empty_fact_groups():
    payload = valid_payload("未见托槽脱落，今天未处理")
    payload["facts"]["findings"] = []
    payload["facts"]["procedures"] = []
    _reject("empty fact groups", payload)


def test_dual_route_keeps_local_candidate_when_glm_not_configured():
    original_key = os.environ.pop("IRIS_GLM_API_KEY", None)
    original_log = iris_server.log_event
    iris_server.log_event = lambda config, message: None
    try:
        response = post("/api/generate-dual-draft", {"notes": "口卫一般，换1725的不锈钢丝"})
    finally:
        iris_server.log_event = original_log
        if original_key is not None:
            os.environ["IRIS_GLM_API_KEY"] = original_key
    assert response["ok"] is True
    assert response["local_candidate"]["source"] == "local-template"
    assert response["glm_candidate"] is None
    assert response["glm_status"]["code"] == "not_configured"
    assert "0.017 x 0.025" in response["local_candidate"]["treatment"]


def test_dual_route_keeps_retainer_template_and_skips_glm():
    original_call = iris_server.call_glm_structured_draft
    original_log = iris_server.log_event
    iris_server.call_glm_structured_draft = lambda notes: (_ for _ in ()).throw(AssertionError("GLM must be skipped"))
    iris_server.log_event = lambda config, message: None
    try:
        response = post("/api/generate-dual-draft", {"notes": "保持器复查，继续维持"})
    finally:
        iris_server.call_glm_structured_draft = original_call
        iris_server.log_event = original_log
    assert response["ok"] is True
    assert response["local_candidate"]["template"] == "retainer-followup"
    assert response["glm_status"]["code"] == "template_skipped"
    assert response["glm_candidate"] is None


def test_dual_route_returns_validated_glm_candidate_without_touching_generate():
    notes = "未见托槽脱落，今天未处理"
    original_call = iris_server.call_glm_structured_draft
    original_log = iris_server.log_event
    iris_server.call_glm_structured_draft = lambda supplied_notes: (valid_payload(supplied_notes), {"model": "stub-glm", "elapsed_ms": 1, "protocol": "test"})
    iris_server.log_event = lambda config, message: None
    try:
        dual = post("/api/generate-dual-draft", {"notes": notes})
        existing = post("/api/generate", {"notes": notes})
    finally:
        iris_server.call_glm_structured_draft = original_call
        iris_server.log_event = original_log
    assert dual["ok"] is True
    assert dual["glm_status"]["code"] == "ok"
    assert dual["glm_candidate"]["source"] == "glm-shadow"
    assert "未见托槽脱落" in dual["glm_candidate"]["examination"]
    assert existing["ok"] is True
    assert "local_candidate" not in existing


def main() -> int:
    tests = [value for name, value in globals().items() if name.startswith("test_") and callable(value)]
    failures = []
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except Exception as exc:
            failures.append((test.__name__, str(exc)))
            print(f"FAIL  {test.__name__}: {exc}")
    print(f"{len(tests) - len(failures)} passed, {len(failures)} failed of {len(tests)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
