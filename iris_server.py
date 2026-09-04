import argparse
import base64
import hashlib
from io import BytesIO
import json
import os
import random
import re
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
TERMS_PATH = APP_DIR / "terms.json"
LOG_LOCK = threading.Lock()


def load_config(path):
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def log_event(config, message):
    log_dir = APP_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n"
    with LOG_LOCK:
        with open(log_dir / "iris-server.log", "a", encoding="utf-8") as handle:
            handle.write(line)


def response_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def decode_image_data_url(value):
    matched = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)", str(value or ""), flags=re.IGNORECASE)
    if not matched:
        raise ValueError("图片格式无效，请重新粘贴或上传 PNG、JPG、WebP 图片。")
    raw = base64.b64decode(re.sub(r"\s+", "", matched.group(2)), validate=True)
    if not raw or len(raw) > 8 * 1024 * 1024:
        raise ValueError("图片不能为空且不能超过 8MB。")
    suffix = {"png": ".png", "jpeg": ".jpg", "webp": ".webp"}[matched.group(1).lower()]
    return raw, suffix


def recover_ceph_value(image_bytes, suffix, words, label_pattern):
    """Recover a faint cephalometric value when OCR loses signs or decimals."""
    target_rows = [y for y, _, text in words if re.search(label_pattern, text, re.IGNORECASE)]
    if not target_rows:
        return ""
    try:
        from PIL import Image
        import cv2
        import numpy as np
    except ImportError:
        return ""

    try:
        image = Image.open(BytesIO(image_bytes)).convert("L")
        width, height = image.size
        row_y = int(target_rows[0])
        # The measurement column begins around the right-most 28% in the
        # standard cephalometric screenshot.  A little vertical context helps
        # Windows OCR distinguish the decimal point from the green arrow.
        top = max(0, row_y - 35)
        bottom = min(height, row_y + 55)
        base_left = int(width * 0.7)
        digit_groups = []
        raw_crop = None
        # OCR is sensitive to the left crop edge.  Try a few nearby edges and
        # retain the result that exposes the most numeric groups.
        for offset in (0, 5, 10, -5):
            left = max(0, min(width - 1, base_left + offset))
            candidate = image.crop((left, top, width, bottom))
            output = BytesIO()
            candidate.resize((candidate.width * 4, candidate.height * 4)).save(output, format="PNG")
            candidate_groups = re.findall(r"\d+", local_windows_ocr(output.getvalue(), ".png", recover_wits=False))
            if len(candidate_groups) > len(digit_groups):
                digit_groups = candidate_groups
                raw_crop = np.array(candidate)
        if len(digit_groups) < 2:
            return ""
        value = f"{''.join(digit_groups[:-1])}.{digit_groups[-1]}"

        # The minus sign is often the only faint character Windows OCR misses.
        _, binary = cv2.threshold(raw_crop, 80, 255, cv2.THRESH_BINARY)
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary)
        components = [stats[index] for index in range(1, count) if stats[index, 4] > 3]
        digit_starts = [item[0] for item in components if item[3] >= 8 and item[2] >= 4]
        if digit_starts:
            first_digit = min(digit_starts)
            has_minus = any(
                item[2] >= 4 and item[3] <= 4 and item[0] + item[2] <= first_digit
                for item in components
            )
            if has_minus:
                value = f"-{value}"
        return value
    except Exception:
        return ""


def local_windows_ocr(image_bytes, suffix, recover_wits=True):
    """Recognize a screenshot with Windows OCR; image data never leaves this computer."""
    script = r'''
param([string]$ImagePath)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-Operation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait() | Out-Null
  return $task.Result
}
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Windows OCR language engine is unavailable.' }
$result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    [Console]::WriteLine(('{0}{1}{2}{1}{3}' -f $word.BoundingRect.Y, [char]9, $word.BoundingRect.X, $word.Text))
  }
}
'''
    with tempfile.TemporaryDirectory(prefix="iris-ceph-") as directory:
        image_path = Path(directory) / f"ceph{suffix}"
        script_path = Path(directory) / "ocr.ps1"
        image_path.write_bytes(image_bytes)
        script_path.write_text(script, encoding="utf-8")
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script_path), str(image_path)],
            capture_output=True,
            timeout=45,
            check=False,
        )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or "Windows OCR 识别失败。")
    words = []
    for line in completed.stdout.decode("utf-8", errors="replace").splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        try:
            words.append((float(parts[0]), float(parts[1]), parts[2].strip()))
        except ValueError:
            continue
    if not words:
        return ""
    words.sort(key=lambda item: (item[0], item[1]))
    rows = []
    for y, x, text in words:
        if not rows or abs(y - rows[-1][0]) > 18:
            rows.append([y, [(x, text)]])
        else:
            rows[-1][1].append((x, text))
    result_text = "\n".join(" ".join(text for _, text in sorted(row_words)) for _, row_words in rows).strip()
    if recover_wits:
        has_wits_value = any(
            re.search(r"wits", line, re.IGNORECASE) and re.search(r"[-+]?\d", line)
            for line in result_text.splitlines()
        )
        if not has_wits_value:
            wits_value = recover_ceph_value(image_bytes, suffix, words, r"wits")
            if wits_value:
                result_text = f"{result_text}\nWits(mm): {wits_value}".strip()
        anb_value = recover_ceph_value(image_bytes, suffix, words, r"anb")
        if anb_value:
            result_text = f"{result_text}\nANB(O): {anb_value}".strip()
    return result_text


def redact_for_log(text):
    text = re.sub(r"\d{11}", "[phone]", text or "")
    text = re.sub(r"\d{17}[\dXx]", "[id]", text)
    return text[:20] + ("..." if len(text) > 20 else "")


def load_terms():
    if not TERMS_PATH.exists():
        return []
    with open(TERMS_PATH, "r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        data = data.get("terms", [])
    return [
        {
            "spoken": str(item.get("spoken", "")).strip(),
            "written": str(item.get("written", "")).strip()
        }
        for item in data
        if isinstance(item, dict) and str(item.get("spoken", "")).strip() and str(item.get("written", "")).strip()
    ]


def save_terms(terms):
    normalized = []
    seen = set()
    for item in terms:
        spoken = str(item.get("spoken", "")).strip()
        written = str(item.get("written", "")).strip()
        key = spoken.casefold()
        if not spoken or not written or key in seen:
            continue
        seen.add(key)
        normalized.append({"spoken": spoken, "written": written})
    with open(TERMS_PATH, "w", encoding="utf-8") as handle:
        json.dump({"terms": normalized}, handle, ensure_ascii=False, indent=2)
    return normalized


def normalize_notes(notes):
    normalized = notes or ""
    terms = load_terms()
    for item in sorted(terms, key=lambda term: len(term["spoken"]), reverse=True):
        normalized = normalized.replace(item["spoken"], item["written"])

    normalized = re.sub(
        r"(上下颌|[上下]颌)\s*(?:换|更换)?\s*18\s*(?:镍钛丝|镍钛|NiTi|niti|NITI)",
        r"\1更换0.018 NiTi",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"(?<!\d)(?:换|更换)?\s*18\s*(?:镍钛丝|镍钛|NiTi|niti|NITI)",
        "更换0.018 NiTi",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"(上下颌|[上下]颌)\s*(?:换|更换)?\s*14\s*(?:镍钛丝|镍钛|NiTi|niti|NITI)",
        r"\1更换0.014 NiTi",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"(?<!\d)(?:换|更换)?\s*14\s*(?:镍钛丝|镍钛|NiTi|niti|NITI)",
        "更换0.014 NiTi",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"(0\.\d{3})\s*(?:镍钛丝|镍钛|NiTi|niti|NITI)", r"\1 NiTi", normalized, flags=re.IGNORECASE)

    wire_patterns = [
        (r"(?<!\d)1622\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝|ss|SS|不锈钢)", "0.016 x 0.022 SS"),
        (r"(?<!\d)1622\s*(?:的)?(?:镍钛丝|镍钛方丝|NiTi|niti|NITI|方丝|丝)", "0.016 x 0.022 NiTi"),
        (r"(?<!\d)1725\s*(?:的)?(?:镍钛丝|镍钛方丝|NiTi|niti|NITI|方丝|丝)", "0.017 x 0.025 NiTi"),
        (r"(?<!\d)1725\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝|ss|SS)?", "0.017 x 0.025 SS"),
        (r"(?<!\d)1925\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝|ss|SS)?", "0.019 x 0.025 SS"),
        (r"(?<!\d)1622(?!\s*(?:不锈钢|钢丝|ss|SS|NiTi|niti|NITI|镍钛))", "0.016 x 0.022 NiTi"),
        (r"(?<!\d)1425\s*(?:的)?(?:镍钛丝|镍钛方丝|方丝|丝)?", "0.014 x 0.025 NiTi"),
        (r"一七二五\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝)?", "0.017 x 0.025 SS"),
        (r"十九二十五\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝)?", "0.019 x 0.025 SS"),
        (r"十七二十五\s*(?:的)?(?:不锈钢丝|不锈钢方丝|方丝|钢丝)?", "0.017 x 0.025 SS"),
        (r"二类牵引", "II类牵引"),
        (r"三类牵引", "III类牵引"),
        (r"橡皮链", "弹力链"),
        (r"片切", "IPR")
    ]
    for pattern, replacement in wire_patterns:
        normalized = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)
    return normalized


def clean_sentence(text):
    text = re.sub(r"\s+", " ", text or "").strip("，,。；; ")
    return f"{text}。" if text else ""


def clean_treatment_lines(text):
    lines = []
    for item in re.split(r"[\n；;]+", text or ""):
        line = re.sub(r"[ \t\r\f\v]+", " ", item).strip("，,。；; ")
        if line:
            lines.append(f"{line}。")
    return "\n".join(dict.fromkeys(lines))


def merge_related_treatments(items):
    merged = []
    for item in items:
        item_jaw = jaw_from_text(item)
        previous_jaw = jaw_from_text(merged[-1]) if merged else ""
        independent_pattern = r"牵引|牙套|矫治器|支抗钉|打钉|种钉|植入钉"
        if (
            merged
            and same_or_compatible_jaw(previous_jaw, item_jaw)
            and not re.search(independent_pattern, merged[-1])
            and not re.search(independent_pattern, item)
        ):
            merged[-1] = f"{merged[-1]}，{item}"
            continue
        if merged and re.search(r"换0\.\d{3}\s*x\s*0\.\d{3}\s*(?:SS|NiTi)", merged[-1], flags=re.IGNORECASE) and re.search(r"靴型曲|压低前牙", item):
            merged[-1] = f"{merged[-1]}，{item}"
            continue
        if merged and re.search(r"粘.*托槽", merged[-1]) and re.search(r"入槽", item):
            merged[-1] = f"{merged[-1]}，{item}"
            continue
        if merged and re.search(r"换0\.\d{3}(?:\s*x\s*0\.\d{3})?\s*(?:SS|NiTi)", merged[-1], flags=re.IGNORECASE) and re.search(r"纳入矫(?:正|治)|入槽", item):
            merged[-1] = f"{merged[-1]}，{item}"
            continue
        if merged and re.search(r"粘.*舌弓", merged[-1]) and re.search(r"缩弓", item):
            merged[-1] = f"{merged[-1]}，{item}"
            continue
        merged.append(item)
    return merged


def clean_examination_lines(text):
    lines = []
    for item in re.split(r"[\n；;]+", text or ""):
        line = re.sub(r"[ \t\r\f\v]+", " ", item).strip("，,。；; ")
        if line:
            lines.append(f"{line}。")
    return "\n".join(dict.fromkeys(lines))


def compact_compare_key(text):
    value = re.sub(r"[\s，,。；;]+", "", text or "").lower()
    return value.replace("牙列", "")


def has_similar_item(items, text):
    key = compact_compare_key(text)
    if not key:
        return True
    for item in items:
        item_key = compact_compare_key(item)
        if key == item_key or key in item_key or item_key in key:
            return True
    return False


def tooth_arch(tooth):
    value = str(tooth or "").strip()
    if not re.fullmatch(r"[1-4][1-8]", value):
        return ""
    return "upper" if value[0] in ("1", "2") else "lower"


def jaw_from_text(text):
    value = text or ""
    if "上下颌" in value:
        return "both"
    if "上颌" in value:
        return "upper"
    if "下颌" in value:
        return "lower"

    arches = {
        tooth_arch(match.group(1))
        for match in re.finditer(r"(?<!\d)([1-4][1-8])(?!\d)", value)
    }
    arches.discard("")
    if len(arches) == 1:
        return next(iter(arches))
    if len(arches) > 1:
        return "mixed"
    return ""


def same_or_compatible_jaw(left, right):
    if not left or not right:
        return False
    if left == "mixed" or right == "mixed":
        return False
    return left == right or left == "both" or right == "both"


def reduce_contained_items(items):
    unique = list(dict.fromkeys(item for item in items if item))
    result = []
    for index, item in enumerate(unique):
      key = compact_compare_key(item)
      if not key:
          continue
      contained = False
      for other_index, other in enumerate(unique):
          if index == other_index:
              continue
          other_key = compact_compare_key(other)
          if key != other_key and key in other_key:
              contained = True
              break
      if not contained:
          result.append(item)
    return result


def split_sentence_groups(text):
    return [group.strip("，,。；; ") for group in re.split(r"[\n；;。]+", text or "") if group.strip("，,。；; ")]


def extract_width_locking_exam_items(text):
    items = []
    for group in split_sentence_groups(text):
        width_match = re.search(r"((?:上下颌|[上下]颌)?宽度不调)", group)
        locking_match = re.search(
            r"((?:左侧|右侧|双侧|左右侧|两侧)?(?:前磨牙区|磨牙区|尖牙区|后牙区|前牙区)?(?:正锁合|反合)(?:趋势)?)",
            group,
        )
        if width_match and locking_match:
            width = width_match.group(1) or "牙弓宽度不调"
            items.append(f"{width}，{locking_match.group(1)}")
    return items


def extract_alignment_appliance_exam_items(text):
    items = []
    appliance = r"(?:托槽|颊管|附件|牵引钩|橡皮链|弹力链)"
    problem = r"(?:脱落|松动)"
    for group in split_sentence_groups(text):
        alignment_match = re.search(r"((?:上下颌|[上下]颌)[^，,。；;]*?(?:未排齐|不齐|排齐不佳))", group)
        appliance_match = re.search(rf"(\d{{1,2}}(?:[.。]\d{{1,2}})*\s*{appliance}\s*{problem})", group)
        if alignment_match and appliance_match:
            alignment = alignment_match.group(1)
            if not same_or_compatible_jaw(jaw_from_text(alignment), jaw_from_text(appliance_match.group(1))):
                continue
            alignment = re.sub(r"(上下颌|上颌|下颌).*", lambda m: f"{m.group(1)}牙列未排齐", alignment)
            appliance_item = re.sub(r"\s+", "", appliance_match.group(1)).replace("。", ".")
            items.append(f"{alignment}，{appliance_item}")
    return items


def normalize_class_relation_label(label):
    value = (label or "").strip()
    value = value.replace("Ⅰ", "I").replace("Ⅱ", "II").replace("Ⅲ", "III")
    value = value.replace("一", "I").replace("二", "II").replace("三", "III")
    value = value.replace("1", "I").replace("2", "II").replace("3", "III")
    return value.upper()


def normalize_relation_side(side):
    if side in ("双侧", "左右侧", "两侧"):
        return "双侧"
    if side == "左":
        return "左侧"
    if side == "右":
        return "右侧"
    return side or ""


def normalize_relation_type(relation_type):
    if re.search(r"尖牙.*磨牙|尖磨牙", relation_type or ""):
        return "尖磨牙"
    return relation_type or ""


def extract_occlusion_relations(text):
    relations = []
    pattern = (
        r"((?:双侧|左右侧|两侧|左侧|右侧|左|右)?)"
        r"(尖磨牙|尖牙(?:和|及|、)?磨牙|尖牙|磨牙)"
        r"关系?偏"
        r"(I{1,3}|Ⅰ|Ⅱ|Ⅲ|1|2|3|一|二|三)"
        r"类"
    )
    for match in re.finditer(pattern, text or "", flags=re.IGNORECASE):
        side = normalize_relation_side(match.group(1))
        relation_type = normalize_relation_type(match.group(2))
        relation_class = normalize_class_relation_label(match.group(3))
        relations.append(f"{side}{relation_type}关系偏{relation_class}类")
    return relations


def extract_appliance_problem_exam_items(text):
    items = []
    text = text or ""
    appliance = r"(?:托槽|颊管|附件|牵引钩|橡皮链|弹力链)"
    problem = r"(?:脱落|松动)"
    patterns = [
        rf"(\d{{1,2}}(?:[.。]\d{{1,2}})*\s*{appliance}\s*{problem})",
        rf"({appliance}\s*\d{{1,2}}(?:[.。]\d{{1,2}})*\s*{problem})",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            item = re.sub(r"\s+", "", match.group(1)).replace("。", ".")
            reverse = re.match(rf"({appliance})(\d{{1,2}}(?:\.\d{{1,2}})*)({problem})", item)
            if reverse:
                item = f"{reverse.group(2)}{reverse.group(1)}{reverse.group(3)}"
            items.append(item)
    return items


def has_examination_signal(text):
    return bool(re.search(r"口卫|卫生|牙套|贴合|未排齐|不齐|排齐|中线|尖牙|磨牙|关系|唇倾|间隙|覆|覆盖|拥挤|扭转|反合|开合|深|浅|倾斜|前突|托槽|颊管|附件|牵引钩|脱落|松动", text or ""))


def split_clauses(text):
    clauses = re.split(r"[，,、。；;\n]+", text or "")
    return [clause.strip() for clause in clauses if clause.strip()]


def normalize_clause_style(clause):
    clause = clause.strip()
    clause = re.sub(r"^今天", "今日", clause)
    clause = clause.replace("粘结", "粘接")
    clause = re.sub(r"^今日换", "今日更换", clause)
    clause = re.sub(r"^((?:上下颌)|[上下]颌)换", r"\1更换", clause)
    clause = re.sub(r"^((?:上下颌)|[上下]颌)(0\.\d{3}\s*x\s*0\.\d{3}\s*(?:SS|NiTi))", r"\1换\2", clause, flags=re.IGNORECASE)
    clause = re.sub(r"^换", "更换", clause)
    return clause


def anchor_screw_treatment(clause):
    if not re.search(r"支抗钉|打钉|种钉|植入钉|植入.*钉", clause):
        return ""

    # A note may contain more than one screw procedure.  Parse each clause on
    # its own so that the first model does not hide a later one.
    screw_clauses = [
        item for item in split_clauses(clause)
        if re.search(r"支抗钉|打钉|种钉|植入钉|植入.*钉", item)
    ]
    if len(screw_clauses) > 1:
        treatments = [anchor_screw_treatment(item) for item in screw_clauses]
        return "\n".join(dict.fromkeys(item for item in treatments if item))

    size_patterns = [
        (r"8\s*[xX×]\s*1[.。]4", "8X1.4", "mm"),
        (r"8\s*[xX×]\s*1[.。]6", "8X1.6", "mm"),
        (r"2\s*[xX×]\s*10", "2X10", "mm"),
        (r"2\s*[xX×]\s*12", "2X12", "mm"),
        # MIA implant codes, for example 1312-06 SH or 1413-10 PH.
        # They are model identifiers, not dimensions, so do not append "mm".
        (r"(?<!\d)(1312|1413)\s*[-—–－]?\s*(06|07|10)\s*[-—–－]?\s*(SH|NH|PH)(?![A-Za-z])", "MIA", ""),
    ]
    for pattern, size, unit in size_patterns:
        if re.search(pattern, clause):
            if size == "MIA":
                model_match = re.search(pattern, clause, flags=re.IGNORECASE)
                size = f"{model_match.group(1)}-{model_match.group(2)} {model_match.group(3).upper()}"
            location_text = ""
            location_match = re.search(
                r"((?:上颌|下颌|左上颌|右上颌|左下颌|右下颌)?)"
                r"((?:\d{1,2}\s*[.。]\s*\d{1,2}\s*(?:之间)?\s*[,，、和及]?\s*){1,4})"
                r"(?:之间)?[^，,。；;]*?(?:支抗钉|打钉|种钉|植入钉|植入.*钉)",
                clause,
            )
            if location_match:
                jaw = location_match.group(1)
                pairs = []
                for pair in re.finditer(r"(\d{1,2})\s*[.。]\s*(\d{1,2})\s*(?:之间)?", location_match.group(2)):
                    pairs.append(f"{pair.group(1)}.{pair.group(2)}之间")
                if pairs:
                    location_text = f"于{jaw}{'、'.join(pairs)}"
            if not location_text:
                anatomical_location_match = re.search(
                    r"(?:于)?((?:上颌|下颌)[^，,。；;]*?)(?:植入|打|种)\s*(?:支抗钉|钉)",
                    clause,
                )
                if anatomical_location_match:
                    location_text = f"于{anatomical_location_match.group(1).strip()}"
            return f"碘伏消毒，必兰麻局麻下，{location_text}植入支抗钉{size}{unit}"
    return ""


def intermaxillary_elastic_treatment(text):
    clauses = split_clauses(text)
    if not clauses:
        return ""

    for index, clause in enumerate(clauses):
        if not re.search(r"牵引", clause):
            continue

        window = "，".join(clauses[index:index + 4])
        vertical_match = re.search(
            r"([上下]颌?\s*\d{1,2})\s*([上下]颌?\s*\d{1,2})\s*垂直牵引",
            window,
            flags=re.IGNORECASE,
        )
        base_match = re.search(
            r"(颌间短?\s*(?:I{1,3}|IV|Ⅰ|Ⅱ|Ⅲ|1|2|3|一|二|三)类牵引|(?:I{1,3}|IV|Ⅰ|Ⅱ|Ⅲ|1|2|3|一|二|三)类牵引)",
            window,
            flags=re.IGNORECASE,
        )
        if vertical_match:
            upper = re.sub(r"\s+", "", vertical_match.group(1))
            lower = re.sub(r"\s+", "", vertical_match.group(2))
            base = f"{upper}至{lower}垂直牵引"
        else:
            # Keep the clinician's position and qualifier words (for example,
            # "左侧后牙短III类牵引").  The former core-word extraction kept
            # only "III类牵引" and silently discarded those details.
            core = base_match.group(1).replace(" ", "") if base_match else ""
            raw_clause = re.sub(r"\s+", "", clause)
            base = raw_clause if core and compact_compare_key(raw_clause) != compact_compare_key(core) else (core or clause)
        base = base.replace("Ⅰ", "I").replace("Ⅱ", "II").replace("Ⅲ", "III")
        base = base.replace("一类", "I类").replace("二类", "II类").replace("三类", "III类")
        base = re.sub(r"(?<!I)1类", "I类", base)
        base = re.sub(r"2类", "II类", base)
        base = re.sub(r"3类", "III类", base)

        parts = [base]
        size_force = re.search(r"(\d+\s*/\s*\d+)\s*[,，]?\s*(\d+(?:\.\d+)?\s*oz)", window, flags=re.IGNORECASE)
        if size_force:
            size = re.sub(r"\s+", "", size_force.group(1))
            force = re.sub(r"\s+", "", size_force.group(2))
            spec = f"{size} {force}"
            if compact_compare_key(spec) not in compact_compare_key(base):
                parts.append(spec)

        tooth_span = re.search(r"([上下]\s*\d+\s*(?:到|至|-)\s*[上下]\s*\d+)", window)
        if tooth_span:
            span = re.sub(r"\s+", "", tooth_span.group(1))
            span = re.sub(r"到|-", "至", span)
            if span not in base:
                parts.append(span)

        return "，".join(parts)
    return ""


def aligner_followup_items(text):
    exam_items = []
    treatment_items = []
    text = text or ""

    wear_match = re.search(r"(?:戴|带)(?:至|到)\s*(?:第)?\s*(\d+)\s*副", text)
    fit_match = re.search(r"牙套\s*(不贴合|贴合)", text)
    if wear_match or fit_match:
        parts = []
        if wear_match:
            parts.append(f"戴至{wear_match.group(1)}副")
        if fit_match:
            parts.append(f"牙套{fit_match.group(1)}")
        exam_items.append("，".join(parts))

    give_match = re.search(
        r"(?:给|给予|发)\s*(?:第)?\s*(\d+)\s*(?:[-－—~到至]\s*(?:第)?\s*(\d+))?\s*(?:副)?\s*(?:牙套|隐形牙套|矫治器)",
        text,
    )
    if give_match:
        start = give_match.group(1)
        end = give_match.group(2)
        range_text = f"{start}-{end}副" if end else f"{start}副"
        treatment = f"给{range_text}牙套"
        if re.search(r"继续佩戴", text):
            treatment = f"{treatment}，继续佩戴"
        treatment_items.append(treatment)
    elif re.search(r"继续佩戴", text) and re.search(r"牙套|隐形牙套|矫治器|(?:戴|带)(?:至|到)\s*(?:第)?\s*\d+\s*副", text):
        treatment_items.append("继续佩戴")

    return exam_items, treatment_items


def is_aligner_followup_signal(text):
    return bool(re.search(r"牙套|隐形牙套|矫治器|(?:戴|带)(?:至|到)\s*(?:第)?\s*\d+\s*副|(?:给|给予|发)\s*(?:第)?\s*\d+", text or ""))


def is_retainer_followup_signal(text):
    return bool(re.search(r"\u4fdd\u6301\u5668\s*(?:\u590d\u67e5|\u590d\u8bca)|(?:\u590d\u67e5|\u590d\u8bca)\s*\u4fdd\u6301\u5668|\u4fdd\u6301\u590d\u67e5", text or "", re.IGNORECASE))


def retainer_followup_record(notes):
    return {
        "source": "retainer-followup-template",
        "template": "retainer-followup",
        "normalizedNotes": notes,
        "chief": "\u4fdd\u6301\u5668\u590d\u67e5",
        "present": "\u4fdd\u6301\u5668\u590d\u67e5",
        "past": "\u4f53\u5065\u3002\u65e0\u7279\u6b8a\u3002\u5426\u8ba4\u7cfb\u7edf\u6027\u75c5\u53f2\u3002",
        "examination": "\u4fdd\u6301\u5668\u5c31\u4f4d\u826f\u597d\uff0c\u4fdd\u6301\u6548\u679c\u53ef\u3002",
        "diagnosis": "\u6b63\u7578\u6cbb\u7597\u540e",
        "plan": "\u7ee7\u7eed\u4fdd\u6301",
        "treatment": "\u7ee7\u7eed\u4fdd\u6301\uff0c\u5b9a\u671f\u590d\u67e5\u3002",
        "advice": "\u4e0d\u9002\u968f\u8bca\u3002",
        "current": "",
        "nextPlan": "\u7ee7\u7eed\u4fdd\u6301",
        "flags": ["\u4fdd\u6301\u5668\u590d\u67e5\u56fa\u5b9a\u6a21\u677f\u5df2\u751f\u6210\uff0c\u4fdd\u5b58\u524d\u9700\u533b\u751f\u5ba1\u6838\u3002"]
    }


def local_generate(notes):
    compact = normalize_notes(notes)
    if is_retainer_followup_signal(compact):
        return retainer_followup_record(compact)
    compact = re.sub(r"\s*\n\s*", "，", compact)
    compact = re.sub(r"[ \t\r\f\v]+", " ", compact).strip()
    if not compact:
        raise ValueError("请先输入复诊要点。")

    exam_items = []
    treatment_items = []
    advice_items = []

    exam_items.extend(extract_alignment_appliance_exam_items(compact))
    exam_items.extend(extract_width_locking_exam_items(compact))

    if re.search(r"口卫好|卫生好|清洁好|口腔卫生好|口腔卫生良好", compact):
        exam_items.append("口腔卫生良好")
    elif re.search(r"口卫差|卫生差|清洁差|菌斑|软垢|牙龈红肿|出血", compact):
        exam_items.append("口腔卫生欠佳")
    elif re.search(r"口卫一般|卫生一般|口腔卫生一般", compact):
        exam_items.append("口腔卫生一般")
    has_jaw_alignment = False
    if re.search(r"上下颌[^，,。；;]*?基本排齐", compact):
        exam_items.append("上下颌牙列基本排齐")
        has_jaw_alignment = True
    if re.search(r"上颌[^，,。；;]*?基本排齐", compact):
        exam_items.append("上颌牙列基本排齐")
        has_jaw_alignment = True
    if re.search(r"(?<!上)下颌[^，,。；;]*?基本排齐", compact):
        exam_items.append("下颌牙列基本排齐")
        has_jaw_alignment = True
    if re.search(r"上下颌[^，,。；;]*?(未排齐|不齐|排齐不佳)", compact):
        exam_items.append("上下颌牙列未排齐")
        has_jaw_alignment = True
    if re.search(r"上颌[^，,。；;]*?(未排齐|不齐|排齐不佳)", compact):
        exam_items.append("上颌牙列未排齐")
        has_jaw_alignment = True
    if re.search(r"(?<!上)下颌[^，,。；;]*?(未排齐|不齐|排齐不佳)", compact):
        exam_items.append("下颌牙列未排齐")
        has_jaw_alignment = True
    if not has_jaw_alignment and re.search(r"未排齐|不齐|排齐不佳", compact):
        exam_items.append("牙列未排齐")
    for match in re.finditer(r"([上下]颌中线[左右]偏\s*\d+(?:\.\d+)?\s*(?:mm|毫米))", compact, flags=re.IGNORECASE):
        exam_items.append(re.sub(r"\s+", "", match.group(1)).replace("毫米", "mm"))
    if re.search(r"下颌中线右偏", compact):
        exam_items.append("下颌中线右偏")
    if re.search(r"下颌中线左偏", compact):
        exam_items.append("下颌中线左偏")
    if re.search(r"上颌中线右偏", compact):
        exam_items.append("上颌中线右偏")
    if re.search(r"上颌中线左偏", compact):
        exam_items.append("上颌中线左偏")
    for match in re.finditer(r"((?:上下颌|[上下]颌)?宽度不调)", compact):
        item = match.group(1)
        exam_items.append(item if item else "牙弓宽度不调")
    exam_items.extend(extract_occlusion_relations(compact))
    for match in re.finditer(r"([上下]颌前牙间隙充足)", compact):
        exam_items.append(match.group(1))
    for match in re.finditer(r"([上下]颌)\s*(?:spee|Spee|SPEE)\s*曲线深", compact, flags=re.IGNORECASE):
        exam_items.append(f"{match.group(1)}Spee曲线深")
    for match in re.finditer(r"([上下]颌前牙唇倾)", compact):
        exam_items.append(match.group(1))
    for match in re.finditer(r"(\d{1,2}\s*(?:近中|远中)?\s*\d+(?:\.\d+)?\s*mm间隙)", compact):
        exam_items.append(re.sub(r"\s+", "", match.group(1)))
    for match in re.finditer(r"(\d{1,2}(?:[.。]\d{1,2})+稍?(?:近中|远中)扭转)", compact):
        exam_items.append(match.group(1).replace("。", "."))
    if re.search(r"近中边缘嵴厚", compact):
        exam_items.append("近中边缘嵴厚")
    for match in re.finditer(r"(\d{1,2}(?:[.。]\d{1,2})*[^，,。；;]*?(?:龋坏|龋齿|龋))", compact):
        exam_items.append(re.sub(r"\s+", "", match.group(1)).replace("。", "."))
    for match in re.finditer(r"((?:牙周|牙龈)[^，,。；;]*?(?:炎|红肿|出血))", compact):
        exam_items.append(match.group(1))
    exam_items.extend(extract_appliance_problem_exam_items(compact))
    aligner_exam_items, aligner_treatment_items = aligner_followup_items(compact)
    exam_items.extend(aligner_exam_items)
    treatment_items.extend(aligner_treatment_items)

    advice_keywords = r"皮筋|橡皮筋|佩戴|告知|嘱|避免|注意|按时|复诊|咬硬物|硬物|疼痛|不适"
    treatment_keywords = r"更换|换|弓丝|SS|NiTi|入槽|纳入矫正|纳入矫治|拟下次重启|下次重启|拟重启|重启|转诊|诊治|暂维持|维持|牵引|推簧|维持间隙|结扎|弹力链|弹力线|转矩|负转矩|靴型曲|压低|附件|托槽|颊管|舌弓|缩弓|粘接|粘结|重粘|脱落|IPR|片切|扩弓|调整|去除|拆除|抛光|拍片|扫描|支抗钉|打钉|种钉|植入钉|牙套|矫治器"

    full_screw_treatment = anchor_screw_treatment(compact)
    if full_screw_treatment:
        treatment_items.append(full_screw_treatment)
    full_elastic_treatment = intermaxillary_elastic_treatment(compact)
    elastic_treatment_added = False

    for clause in split_clauses(compact):
        normalized_clause = normalize_clause_style(clause)
        if aligner_treatment_items and re.search(r"牙套|矫治器|继续佩戴|(?:戴|带)(?:至|到)\s*(?:第)?\s*\d+\s*副|(?:给|给予|发)\s*(?:第)?\s*\d+", normalized_clause):
            continue
        screw_treatment = anchor_screw_treatment(normalized_clause)
        if screw_treatment:
            if not full_screw_treatment:
                treatment_items.append(screw_treatment)
            continue
        if re.search(r"支抗钉|打钉|种钉|植入钉|植入.*钉", normalized_clause):
            continue
        if full_elastic_treatment and (
            re.search(r"牵引", normalized_clause)
            or re.search(r"\d+\s*/\s*\d+|\d+(?:\.\d+)?\s*oz|[上下]\s*\d+\s*(?:到|至|-)\s*[上下]\s*\d+", normalized_clause, flags=re.IGNORECASE)
        ):
            if re.search(r"牵引", normalized_clause) and not elastic_treatment_added:
                treatment_items.append(full_elastic_treatment)
                elastic_treatment_added = True
            continue
        if re.search(r"注意口腔卫生|注意.*卫生|保持.*卫生|加强.*卫生", normalized_clause):
            advice_items.append("注意口腔卫生")
            continue
        if re.search(r"口卫|口腔卫生|卫生", normalized_clause):
            continue
        if re.search(r"(?:龋坏|龋齿|龋|牙周|牙龈)", normalized_clause) and not re.search(r"转诊|诊治|处理|处置|治疗", normalized_clause):
            continue
        if re.search(r"(?:托槽|颊管|附件|牵引钩|橡皮链|弹力链).*(?:脱落|松动)|(?:脱落|松动).*(?:托槽|颊管|附件|牵引钩|橡皮链|弹力链)", normalized_clause) and not re.search(r"重粘|粘接|粘结|粘|入槽", normalized_clause):
            continue
        if re.search(advice_keywords, normalized_clause) and not re.search(r"更换|^换|弓丝|SS|NiTi|粘接|重粘|IPR|片切|扩弓|调整|去除|拆除", normalized_clause):
            advice_items.append(normalized_clause)
            continue
        if re.search(treatment_keywords, normalized_clause):
            treatment_items.append(normalized_clause)
            continue
        if normalized_clause and not has_similar_item(exam_items, normalized_clause):
            exam_items.append(normalized_clause)

    examination = "\n".join(reduce_contained_items(exam_items))
    treatment = "\n".join(merge_related_treatments(list(dict.fromkeys(treatment_items))))
    advice = "；".join(dict.fromkeys(advice_items))
    examination_text = clean_examination_lines(examination)
    treatment_text = clean_treatment_lines(treatment)
    advice_text = clean_sentence(advice)

    flags = []
    if re.search(r"疼|痛|脱落|松动|扎嘴|牙龈|出血|黑三角|牙根|吸收", compact):
        flags.append("输入中包含不适或风险词，请医生确认是否需要补充风险告知。")
    flags.append("该文本由 Iris 根据医生要点整理，保存前需医生审核。")

    return {
        "source": "local-template",
        "normalizedNotes": compact,
        "examination": examination_text,
        "treatment": treatment_text,
        "advice": advice_text,
        "current": f"检查：{examination_text}\n处置：{treatment_text}",
        "nextPlan": "",
        "flags": flags
    }


def parse_ai_record(parsed, normalized_notes, source):
    examination = str(parsed.get("examination", "") or parsed.get("exam", "") or "").strip()
    treatment = str(parsed.get("treatment", "") or parsed.get("procedure", "") or "").strip()
    advice = str(parsed.get("advice", "")).strip()
    examination = polish_record_field(examination)
    treatment = polish_record_field(treatment)
    advice = polish_record_field(advice)
    return {
        "source": source,
        "normalizedNotes": normalized_notes,
        "examination": examination,
        "treatment": treatment,
        "advice": advice,
        "current": f"检查：{examination}\n处置：{treatment}".strip(),
        "nextPlan": "",
        "flags": parsed.get("flags") if isinstance(parsed.get("flags"), list) else []
    }


def stabilize_record_with_template(record, notes):
    try:
        template = local_generate(notes)
    except Exception:
        return record

    # Fixed visit templates own every EKanYa field. Do not let an AI response
    # discard their template marker or replace their fixed diagnosis/plan.
    if template.get("template") == "retainer-followup":
        return template

    stabilized = dict(record)
    for field in ("examination", "treatment", "advice"):
        if template.get(field):
            stabilized[field] = template[field]
    if is_aligner_followup_signal(notes) and template.get("treatment"):
        stabilized["advice"] = template.get("advice", "")
    if not template.get("examination") and (template.get("treatment") or template.get("advice")) and not has_examination_signal(notes):
        stabilized["examination"] = ""

    examination = stabilized.get("examination", "")
    treatment = stabilized.get("treatment", "")
    stabilized["current"] = f"检查：{examination}\n处置：{treatment}".strip()
    if record.get("source") == "ai":
        stabilized["source"] = "ai+template"
    return stabilized


def polish_record_field(text):
    text = re.sub(r"\s+", " ", text or "").strip()
    text = text.replace("口卫一般", "口腔卫生一般")
    text = text.replace("口卫良好", "口腔卫生良好")
    text = text.replace("口卫欠佳", "口腔卫生欠佳")
    text = re.sub(r"^今天换", "今日更换", text)
    text = re.sub(r"^今日换", "今日更换", text)
    text = re.sub(r"^换", "今日更换", text)
    return clean_sentence(text)


def build_ai_messages(notes):
    system = (
        "你是 Iris，正畸复诊病历固定格式转换器，不是自由写作助手。"
        "只根据输入做归类和标准化，不推测、不补充、不扩写。"
        "只输出一个 JSON 对象，不要输出 Markdown，不要解释。"
        "字段必须是 examination, treatment, advice, flags。"
    )
    normalized_notes = normalize_notes(notes)
    normalized_notes = re.sub(r"\s*\n\s*", "，", normalized_notes)
    normalized_notes = re.sub(r"[ \t\r\f\v]+", " ", normalized_notes).strip()
    user = (
        "把医生口头要点转成固定书面病历。固定映射："
        "口卫一般=口腔卫生一般；口卫好=口腔卫生良好；口卫差=口腔卫生欠佳；"
        "今天换/换=今日更换；上颌18NiTi=上颌更换0.018 NiTi；下颌1622不锈钢=下颌换0.016 x 0.022 SS；"
        "打钉/支抗钉且型号为8X1.4、8X1.6、2X10、2X12时，"
        "treatment固定写：碘伏消毒，必兰麻局麻下，植入支抗钉{型号}mm；"
        "MIA支抗钉型号1312或1413加06/07/10及SH/NH/PH（如1312-06 SH）时，"
        "treatment固定写：碘伏消毒，必兰麻局麻下，保留牙位位置并植入支抗钉{完整型号}，不添加mm；"
        "颌间短III类牵引，3/16 3.5oz，上4到下3 这类牵引规格归入 treatment，写成：颌间短III类牵引，3/16 3.5oz，上4至下3；"
        "二类牵引=II类牵引；三类牵引=III类牵引。"
        "规则：examination 只写检查；treatment 只写实际处置；"
        "牙位+托槽/颊管/附件+脱落或松动归入 examination，例如11托槽脱落=examination写11托槽脱落；"
        "龋坏、龋齿、牙龈炎、牙周炎归入 examination；"
        "转诊、诊治、暂维持、维持归入 treatment；"
        "重粘托槽、粘颊管、粘附件、入槽才归入 treatment；"
        "上下颌宽度不调、上颌宽度不调、下颌宽度不调归入 examination；"
        "宽度不调和正锁合/反合趋势是相关检查项，需写在同一句，例如上下颌宽度不调，右侧前磨牙区正锁合趋势；"
        "牙位标记规则：1*、2*为上颌，3*、4*为下颌；"
        "同一组检查中未排齐和托槽/颊管/附件脱落只有同颌才写在同一句，例如上颌牙列未排齐，27颊管脱落；若跨颌则分行；"
        "处置中同颌相邻操作可合并到同一行，跨颌操作分行；"
        "粘舌弓、缩弓归入 treatment，若连续出现可写成一行，例如下颌36.46粘舌弓，缩弓；"
        "拟下次重启、下次重启、拟重启归入 treatment，不要写入 examination；"
        "弹力线加负转矩、加转矩、弹力链、结扎、弓丝更换、靴型曲压低前牙均归入 treatment，不可遗漏；"
        "treatment 中粘托槽、换弓丝、弹力线加力、牵引等独立项目必须分行书写；"
        "检查中必须保留医生说的部位：上下颌未排齐=上下颌牙列未排齐；若医生分别说上颌...、下颌...，则上颌和下颌分行书写；"
        "advice 只写医生明确说出的特殊医嘱，不要把牵引写入 advice；"
        "不要新增医生没说的内容；flags 为空数组或风险提醒。"
        f"要点：{normalized_notes}"
    )
    return normalized_notes, system, user


def call_openai_responses(base_url, api_key, model, notes):
    normalized_notes, system, user = build_ai_messages(notes)
    url = f"{base_url}/responses"
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "examination": {"type": "string"},
            "treatment": {"type": "string"},
            "advice": {"type": "string"},
            "flags": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["examination", "treatment", "advice", "flags"]
    }
    body = {
        "model": model,
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "iris_orthodontic_record",
                "schema": schema,
                "strict": True
            }
        }
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload.get("output_text")
    if not content:
        for item in payload.get("output", []):
            for part in item.get("content", []):
                if part.get("type") in ("output_text", "text") and part.get("text"):
                    content = part["text"]
                    break
            if content:
                break
    if not content:
        raise RuntimeError("OpenAI response did not include output text.")
    parsed = json.loads(content)
    return parse_ai_record(parsed, normalized_notes, "openai")


def call_chat_completions(base_url, api_key, model, notes):
    normalized_notes, system, user = build_ai_messages(notes)
    url = f"{base_url}/chat/completions"
    body = {
        "model": model,
        "max_tokens": 800,
        "temperature": 0,
        "top_p": 0.1,
        "stream": False,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
    }
    if "api.deepseek.com" in base_url:
        body["thinking"] = {"type": "disabled"}
        body["response_format"] = {"type": "json_object"}
    if "api.kukuit.com" in base_url:
        payload = post_chat_with_curl(url, api_key, body)
        content = payload["choices"][0]["message"]["content"]
        parsed = parse_json_text(content)
        return parse_ai_record(parsed, normalized_notes, "ai")

    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    parsed = parse_json_text(content)
    return parse_ai_record(parsed, normalized_notes, "ai")


def quote_curl_config(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def post_chat_with_curl(url, api_key, body):
    curl_config_path = None
    auth_value = api_key if "api.kukuit.com" in url else f"Bearer {api_key}"
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".curl") as handle:
            curl_config_path = handle.name
            handle.write(f'url = "{quote_curl_config(url)}"\n')
            handle.write('request = "POST"\n')
            handle.write('header = "Content-Type: application/json"\n')
            handle.write('header = "Accept: application/json"\n')
            handle.write(f'header = "Authorization: {quote_curl_config(auth_value)}"\n')

        body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
        marker = "\n__IRIS_HTTP_STATUS__:"
        command = [
            "curl.exe",
            "-sS",
            "--max-time",
            "90",
            "--config",
            curl_config_path,
            "--data-binary",
            "@-",
            "--write-out",
            marker + "%{http_code}",
        ]
        result = None
        for attempt in range(2):
            result = subprocess.run(command, input=body_bytes, capture_output=True, check=False)
            if result.returncode == 0:
                break
            time.sleep(0.8)
        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        if result.returncode != 0:
            raise RuntimeError(f"curl failed rc={result.returncode} detail={stderr[:240]}")
        if marker not in stdout:
            raise RuntimeError(f"curl response missing status detail={stdout[:240]}")
        response_text, status_text = stdout.rsplit(marker, 1)
        status = int((status_text.strip() or "0")[:3])
        if status < 200 or status >= 300:
            detail = re.sub(r"sk-[A-Za-z0-9_-]+", "[api-key]", response_text)
            detail = re.sub(r"\s+", " ", detail).strip()
            raise RuntimeError(f"curl HTTP status={status} detail={detail[:240]}")
        return json.loads(response_text)
    finally:
        if curl_config_path:
            try:
                os.remove(curl_config_path)
            except OSError:
                pass


def parse_json_text(content):
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def call_ai_generate(config, notes):
    ai_config = config.get("ai") or {}
    if not ai_config.get("enabled", True):
        return None

    api_key = os.environ.get("IRIS_AI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("IRIS_AI_MODEL") or ai_config.get("model")
    if not api_key or not model:
        return None

    base_url = (os.environ.get("IRIS_AI_BASE_URL") or ai_config.get("baseUrl") or "").rstrip("/")
    if not base_url:
        return None

    provider = str(os.environ.get("IRIS_AI_PROVIDER") or ai_config.get("provider") or "").lower()
    if provider in ("openai", "openai-responses") or "api.openai.com" in base_url:
        return call_openai_responses(base_url, api_key, model, notes)
    return call_chat_completions(base_url, api_key, model, notes)


def describe_ai_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        detail = re.sub(r"sk-[A-Za-z0-9_-]+", "[api-key]", detail)
        detail = re.sub(r"\s+", " ", detail).strip()
        return f"HTTPError status={exc.code} reason={exc.reason} detail={detail[:240]}"
    return f"{type(exc).__name__}: {str(exc)[:160]}"


class CdpWebSocket:
    def __init__(self, ws_url):
        parsed = urllib.parse.urlparse(ws_url)
        self.host = parsed.hostname
        self.port = parsed.port or 80
        self.path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        self.sock = None
        self.next_id = 1

    def __enter__(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=8)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = self.sock.recv(4096)
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("Chrome debugging websocket handshake failed.")
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.sock:
                self.sock.close()
        finally:
            self.sock = None

    def _send_frame(self, text):
        data = text.encode("utf-8")
        header = bytearray([0x81])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.sock.sendall(bytes(header) + mask + masked)

    def _recv_frame(self):
        first = self.sock.recv(2)
        if len(first) < 2:
            raise RuntimeError("Chrome debugging websocket closed.")
        byte1, byte2 = first
        opcode = byte1 & 0x0F
        masked = bool(byte2 & 0x80)
        length = byte2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        mask = self._read_exact(4) if masked else b""
        data = self._read_exact(length)
        if masked:
            data = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        if opcode == 8:
            raise RuntimeError("Chrome debugging websocket closed.")
        return data.decode("utf-8", errors="replace")

    def _read_exact(self, length):
        chunks = []
        remaining = length
        while remaining:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise RuntimeError("Chrome debugging websocket closed.")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def command(self, method, params=None):
        command_id = self.next_id
        self.next_id += 1
        self._send_frame(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self._recv_frame())
            if message.get("id") == command_id:
                if "error" in message:
                    raise RuntimeError(message["error"].get("message", "Chrome command failed."))
                return message.get("result", {})


def get_ekanya_target(config):
    port = int(config.get("debugPort") or 9223)
    login_host = urllib.parse.urlparse(config.get("loginUrl", "")).hostname or "myourhis.myourchina.cn"
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as response:
        targets = json.loads(response.read().decode("utf-8"))

    pages = [
        target for target in targets
        if target.get("type") == "page"
        and target.get("webSocketDebuggerUrl")
        and login_host in target.get("url", "")
        and "LogOn" not in target.get("url", "")
    ]
    if not pages:
        pages = [
            target for target in targets
            if target.get("type") == "page"
            and target.get("webSocketDebuggerUrl")
            and login_host in target.get("url", "")
        ]
    if not pages:
        raise RuntimeError("未找到已打开的 E看牙页面。请先登录 E看牙并打开病历编辑页。")
    return pages[0]


def evaluate_on_ekanya(config, expression, await_promise=True):
    target = get_ekanya_target(config)
    with CdpWebSocket(target["webSocketDebuggerUrl"]) as cdp:
        cdp.command("Runtime.enable")
        result = cdp.command("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True
        })
    if result.get("exceptionDetails"):
        details = result["exceptionDetails"]
        exception = details.get("exception") or {}
        raise RuntimeError(exception.get("description") or details.get("text") or "E看牙页面脚本执行失败。")
    value = ((result.get("result") or {}).get("value"))
    return value


def fill_script(record):
    payload = json.dumps(record, ensure_ascii=False)
    return f"""
(async () => {{
  const record = {payload};
  const examination = record.examination || '';
  const treatment = record.treatment || record.current || '';
  const advice = record.advice || '';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {{
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 30 && rect.height > 12;
  }};
  const textOf = (el) => ((el && (el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.title)) || '').replace(/\\s+/g, '');
  const fieldText = (el) => {{
    const parts = [textOf(el), textOf(el.closest('label'))];
    let node = el;
    for (let i = 0; node && i < 5; i += 1, node = node.parentElement) {{
      parts.push(textOf(node));
      const previous = node.previousElementSibling;
      if (previous) parts.push(textOf(previous));
    }}
    return parts.join('|');
  }};
  const fields = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], .ql-editor, .w-e-text')]
    .filter(visible)
    .filter((el) => !/search|搜索|查询|手机号|电话|姓名|编号/.test(fieldText(el)));
  if (!fields.length) {{
    return {{ ok: false, message: '未找到可填入的病历文本框。请打开 E看牙病历编辑页后再试。', filled: [] }};
  }}
  const setValue = (el, value) => {{
    el.scrollIntoView({{ block: 'center', inline: 'center' }});
    el.focus();
    if (el.matches('textarea, input')) {{
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }} else {{
      el.innerText = value;
      el.textContent = value;
    }}
    for (const name of ['input', 'change', 'keyup', 'blur']) {{
      el.dispatchEvent(new Event(name, {{ bubbles: true }}));
    }}
  }};
  const combined = `【检查】\\n${{examination}}\\n\\n【处置】\\n${{treatment}}\\n\\n【医嘱】\\n${{advice}}`;
  const currentText = `检查：${{examination}}\\n处置：${{treatment}}\\n医嘱：${{advice}}`;
  const nextText = record.nextPlan ? `下次计划：${{record.nextPlan}}` : '';
  const currentWords = /本次|病程|病历|记录|处置|治疗|检查|医嘱|复诊/;
  const nextWords = /下次|下回|计划|预约|复查|复诊计划|治疗计划/;
  let currentField = fields.find((el) => currentWords.test(fieldText(el)));
  let nextField = fields.find((el) => nextWords.test(fieldText(el)) && el !== currentField);
  const filled = [];
  if (currentField && nextField) {{
    setValue(currentField, currentText);
    filled.push({{ target: '本次记录/医嘱', hint: fieldText(currentField).slice(0, 80) }});
    if (nextText) {{
      await sleep(80);
      setValue(nextField, nextText);
      filled.push({{ target: '下次计划', hint: fieldText(nextField).slice(0, 80) }});
    }}
  }} else if (currentField) {{
    setValue(currentField, combined);
    filled.push({{ target: '综合病历', hint: fieldText(currentField).slice(0, 80) }});
  }} else if (fields.length === 1) {{
    setValue(fields[0], combined);
    filled.push({{ target: '唯一文本框', hint: fieldText(fields[0]).slice(0, 80) }});
  }} else {{
    return {{ ok: false, message: '页面上有多个文本框，但 Iris 无法可靠判断病历字段。请手动粘贴预览内容。', filled: [] }};
  }}
  window.__irisLastRecordFilled = true;
  return {{ ok: true, message: '已填入 E看牙页面，请医生审核后再保存。', filled, url: location.href }};
}})()
"""


def save_prompt_script():
    return r"""
(async () => {
  if (!window.__irisLastRecordFilled) {
    return { ok: false, message: 'Iris 尚未在此页面填入内容。' };
  }
  const confirmed = window.confirm('Iris 已填入复诊病历。请确认页面内容无误后点击“确定”，Iris 将尝试点击保存；点击“取消”则不保存。');
  if (!confirmed) return { ok: true, saved: false, message: '医生已取消保存。' };
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => ((el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title)) || '').replace(/\s+/g, '');
  const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"], .ant-btn, .el-button, .ivu-btn, [class*="btn" i]')]
    .filter(visible);
  const button = candidates.find((el) => /保存病历|保存|提交/.test(textOf(el)));
  if (!button) return { ok: false, saved: false, message: '未找到保存按钮，请手动保存。' };
  button.scrollIntoView({ block: 'center', inline: 'center' });
  button.focus?.();
  button.click();
  return { ok: true, saved: true, message: '已按医生确认点击保存按钮。' };
})()
"""


class IrisHandler(BaseHTTPRequestHandler):
    config = None

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index.html"):
            path = APP_DIR / "index.html"
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api/health"):
            response_json(self, 200, {"ok": True, "name": "Iris"})
            return
        if self.path.startswith("/api/terms"):
            response_json(self, 200, {"ok": True, "terms": load_terms()})
            return
        response_json(self, 404, {"ok": False, "message": "Not found"})

    def do_POST(self):
        try:
            if self.path == "/api/generate":
                payload = read_json_body(self)
                notes = str(payload.get("notes") or "").strip()
                log_event(self.config, f"generate requested length={len(notes)}")
                if is_retainer_followup_signal(notes):
                    record = retainer_followup_record(normalize_notes(notes))
                    log_event(self.config, "retainer follow-up fixed template used; AI skipped")
                else:
                    try:
                        record = call_ai_generate(self.config, notes)
                    except Exception as exc:
                        log_event(self.config, f"ai fallback: {describe_ai_error(exc)}")
                        record = None
                    if record is None:
                        record = local_generate(notes)
                    else:
                        record = stabilize_record_with_template(record, notes)
                if not record.get("examination") and not record.get("treatment") and not record.get("advice"):
                    fallback = local_generate(notes)
                    record = {**fallback, **{k: v for k, v in record.items() if v}}
                response_json(self, 200, {"ok": True, "record": record})
                return
            if self.path == "/api/terms":
                payload = read_json_body(self)
                spoken = str(payload.get("spoken") or "").strip()
                written = str(payload.get("written") or "").strip()
                if not spoken or not written:
                    response_json(self, 400, {"ok": False, "message": "请填写口语表达和书面表达。"})
                    return
                terms = [item for item in load_terms() if item["spoken"].casefold() != spoken.casefold()]
                terms.append({"spoken": spoken, "written": written})
                response_json(self, 200, {"ok": True, "terms": save_terms(terms)})
                return
            if self.path == "/api/ceph-ocr":
                payload = read_json_body(self)
                image_bytes, suffix = decode_image_data_url(payload.get("imageData"))
                text = local_windows_ocr(image_bytes, suffix)
                log_event(self.config, f"ceph OCR completed chars={len(text)}")
                response_json(self, 200, {"ok": True, "text": text})
                return
            if self.path == "/api/fill":
                payload = read_json_body(self)
                record = payload.get("record") or {}
                log_event(self.config, "fill requested")
                result = evaluate_on_ekanya(self.config, fill_script(record))
                response_json(self, 200, result if isinstance(result, dict) else {"ok": False, "message": "填入结果异常。"})
                return
            if self.path == "/api/confirm-save":
                log_event(self.config, "confirm-save requested")
                result = evaluate_on_ekanya(self.config, save_prompt_script())
                response_json(self, 200, result if isinstance(result, dict) else {"ok": False, "message": "保存确认结果异常。"})
                return
            response_json(self, 404, {"ok": False, "message": "Not found"})
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            log_event(self.config, f"network error: {type(exc).__name__}")
            response_json(self, 502, {"ok": False, "message": "连接失败。请确认 Iris 服务、E看牙页面或 AI 配置是否可用。"})
        except Exception as exc:
            log_event(self.config, f"error: {type(exc).__name__}: {str(exc)[:120]}")
            response_json(self, 500, {"ok": False, "message": str(exc)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9323)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    config = load_config(args.config)
    config["_config_path"] = args.config
    IrisHandler.config = config

    server = ThreadingHTTPServer((args.host, args.port), IrisHandler)
    log_event(config, f"Iris server started at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
