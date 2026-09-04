const DEFAULT_BASE_URL = "http://127.0.0.1:9323";

async function getBaseUrl() {
  const stored = await chrome.storage.local.get({ irisBaseUrl: DEFAULT_BASE_URL });
  return String(stored.irisBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function postJson(path, payload) {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "Iris 本地服务暂不可用。");
  }
  return data;
}

async function getJson(path) {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "Iris 本地服务暂不可用。");
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "IRIS_HEALTH") {
      sendResponse(await getJson("/api/health"));
      return;
    }
    if (message?.type === "IRIS_GENERATE") {
      sendResponse(await postJson("/api/generate", { notes: message.notes || "" }));
      return;
    }
    if (message?.type === "IRIS_OCR_CEPH") {
      sendResponse(await postJson("/api/ceph-ocr", { imageData: message.imageData || "" }));
      return;
    }
    if (message?.type === "IRIS_GET_TERMS") {
      sendResponse(await getJson("/api/terms"));
      return;
    }
    if (message?.type === "IRIS_ADD_TERM") {
      sendResponse(await postJson("/api/terms", {
        spoken: message.spoken || "",
        written: message.written || ""
      }));
      return;
    }
    sendResponse({ ok: false, message: "未知 Iris 操作。" });
  })().catch((error) => {
    sendResponse({ ok: false, message: error.message || "Iris 操作失败。" });
  });
  return true;
});
