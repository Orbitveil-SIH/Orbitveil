// src/content/capture.js
async function captureScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowType: "normal" });
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollTo(0, 0)
      });
    }
  } catch (e) {
    console.warn("captureScreenshot: failed to reset scroll position:", e.message);
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: "png"
  });
  if (!dataUrl) {
    throw new Error("captureScreenshot: chrome.tabs.captureVisibleTab returned nothing");
  }
  const base64Prefix = "base64,";
  const prefixIndex = dataUrl.indexOf(base64Prefix);
  if (prefixIndex === -1) {
    throw new Error("captureScreenshot: unexpected data URL format");
  }
  const base64Image = dataUrl.slice(prefixIndex + base64Prefix.length);
  return base64Image;
}

// src/content/executor.js
function executeActionInPage(action) {
  try {
    let resolveTarget = function(target2) {
      if (!target2) return null;
      try {
        const el = document.querySelector(target2);
        if (el) return el;
      } catch (e) {
      }
      const candidates = document.querySelectorAll(
        "input, textarea, select, button, a, [role='button']"
      );
      const needle = String(target2).toLowerCase().trim();
      if (!needle) return null;
      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      }
      function getLabelText(el) {
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) return label.textContent || "";
        }
        const parentLabel = el.closest("label");
        if (parentLabel) return parentLabel.textContent || "";
        return "";
      }
      function fieldsOf(el) {
        return [
          getLabelText(el),
          el.getAttribute("placeholder") || "",
          el.getAttribute("name") || "",
          el.getAttribute("id") || "",
          el.getAttribute("aria-label") || "",
          el.textContent || "",
          el.value || ""
        ].join(" ").toLowerCase();
      }
      let bestMatch = null;
      let bestScore = 0;
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const haystack = fieldsOf(el);
        if (!haystack.trim()) continue;
        let score = 0;
        if (haystack.includes(needle)) {
          score = needle.length;
        } else {
          const needleWords = needle.split(/\s+/).filter(Boolean);
          const matchedWords = needleWords.filter((w) => haystack.includes(w));
          score = matchedWords.length / Math.max(needleWords.length, 1);
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = el;
        }
      }
      return bestMatch;
    }, doClick = function(el) {
      if (!el) return { success: false, error: "No matching element found for click." };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      if (typeof el.focus === "function") el.focus();
      el.click();
      return { success: true };
    }, doType = function(el, text) {
      if (!el) return { success: false, error: "No matching element found for type." };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      if (typeof el.focus === "function") el.focus();
      const tag = el.tagName.toLowerCase();
      if (tag === "select") {
        el.value = text;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      const proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    }, doScroll = function(directionValue) {
      const amount = Math.round(window.innerHeight * 0.8);
      const dir = (directionValue || "down").toLowerCase();
      const delta = dir === "up" ? -amount : amount;
      window.scrollBy({ top: delta, behavior: "instant" });
      return { success: true };
    };
    const { type, target, value } = action || {};
    switch (type) {
      case "click": {
        const el = resolveTarget(target);
        return doClick(el);
      }
      case "type": {
        const el = resolveTarget(target);
        return doType(el, value ?? "");
      }
      case "scroll": {
        return doScroll(value);
      }
      case "wait":
      case "done":
        return { success: true };
      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// src/background/service-worker.js
var SERVER_BASE_URL = "http://localhost:8000";
async function startSession(taskDescription) {
  const res = await fetch(`${SERVER_BASE_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_description: taskDescription })
  });
  if (!res.ok) throw new Error(`startSession failed: ${res.status}`);
  return res.json();
}
async function stepSession(sessionId, domSummary, redactedImageB64) {
  const res = await fetch(`${SERVER_BASE_URL}/session/${sessionId}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dom_summary: domSummary,
      redacted_image_b64: redactedImageB64
    })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`stepSession failed: ${res.status} ${errBody.detail || ""}`);
  }
  return res.json();
}
async function deleteSession(sessionId) {
  try {
    await fetch(`${SERVER_BASE_URL}/session/${sessionId}`, { method: "DELETE" });
  } catch (e) {
    console.warn("deleteSession cleanup failed (non-fatal):", e);
  }
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  if (!tabs || tabs.length === 0) {
    throw new Error("No active tab found. Open a page in a normal browser window first.");
  }
  const isValidTarget = (tab) => tab.url && /^(https?|file):\/\//.test(tab.url);
  if (isValidTarget(tabs[0])) {
    return tabs[0];
  }
  const allTabs = await chrome.tabs.query({ windowType: "normal" });
  const validTabs = allTabs.filter(isValidTarget);
  if (validTabs.length > 0) {
    validTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    console.warn(
      `[getActiveTab] Active tab was "${tabs[0].url}" (not a webpage) - falling back to "${validTabs[0].url}" instead.`
    );
    return validTabs[0];
  }
  throw new Error(
    `No valid webpage tab found. Active tab was "${tabs[0].url}" - close any DevTools windows and focus your demo page before clicking Start.`
  );
}
var OFFSCREEN_URL = "offscreen.html";
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) {
    try {
      await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" });
      return;
    } catch (e) {
      console.warn("Offscreen document exists but is unresponsive, recreating:", e);
      try {
        await chrome.offscreen.closeDocument();
      } catch (closeErr) {
        console.warn("closeDocument() failed (non-fatal):", closeErr);
      }
    }
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["BLOBS"],
      justification: "Run on-device face detection (MediaPipe) which requires dynamic import() and canvas APIs unavailable in the service worker."
    });
  } catch (err) {
    if (String(err).includes("single offscreen document")) {
      console.warn("Offscreen document already exists (race), continuing.");
      return;
    }
    throw err;
  }
}
async function detectFacesViaOffscreen(dataUrl) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_DETECT_FACES",
    dataUrl
  });
  if (!response || !response.ok) {
    throw new Error(`Offscreen face detection failed: ${response?.error || "unknown error"}`);
  }
  return response;
}
async function redactScreenshotViaOffscreen(screenshotB64, faces, pii) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_REDACT_SCREENSHOT",
    screenshotB64,
    faces,
    pii
  });
  if (!response || !response.ok) {
    throw new Error(`Offscreen redaction failed: ${response?.error || "unknown error"}`);
  }
  return response.result;
}
async function applyLiveRedaction(tab, redactions = { faces: 0, pii: 0 }) {
  const shouldBlur = (redactions?.faces || 0) > 0 || (redactions?.pii || 0) > 0;
  if (!shouldBlur) {
    return { protected: 0, reason: "no-faces-or-pii-detected" };
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const mark = (el) => {
        if (!el || el.dataset.orbitveilProtected === "true") return;
        const originalFilter = el.style.filter || "";
        const originalPointerEvents = el.style.pointerEvents || "";
        const originalOpacity = el.style.opacity || "";
        const originalBackground = el.style.background || "";
        const originalColor = el.style.color || "";
        const originalUserSelect = el.style.userSelect || "";
        el.dataset.orbitveilProtected = "true";
        el.dataset.orbitveilOriginalFilter = originalFilter;
        el.dataset.orbitveilOriginalPointerEvents = originalPointerEvents;
        el.dataset.orbitveilOriginalOpacity = originalOpacity;
        el.dataset.orbitveilOriginalBackground = originalBackground;
        el.dataset.orbitveilOriginalColor = originalColor;
        el.dataset.orbitveilOriginalUserSelect = originalUserSelect;
        if (el.tagName && el.tagName.toLowerCase() === "img") {
          el.style.filter = "blur(12px) brightness(0.35) grayscale(1)";
          el.style.opacity = "0.2";
        } else {
          el.style.filter = "blur(6px)";
          el.style.background = "rgba(0,0,0,0.85)";
          el.style.color = "transparent";
          el.style.opacity = "0.35";
          el.style.userSelect = "none";
        }
        el.style.pointerEvents = "none";
      };
      const unmark = (el) => {
        if (!el || el.dataset.orbitveilProtected !== "true") return;
        el.style.filter = el.dataset.orbitveilOriginalFilter || "";
        el.style.pointerEvents = el.dataset.orbitveilOriginalPointerEvents || "";
        el.style.opacity = el.dataset.orbitveilOriginalOpacity || "";
        el.style.background = el.dataset.orbitveilOriginalBackground || "";
        el.style.color = el.dataset.orbitveilOriginalColor || "";
        el.style.userSelect = el.dataset.orbitveilOriginalUserSelect || "";
        delete el.dataset.orbitveilOriginalFilter;
        delete el.dataset.orbitveilOriginalPointerEvents;
        delete el.dataset.orbitveilOriginalOpacity;
        delete el.dataset.orbitveilOriginalBackground;
        delete el.dataset.orbitveilOriginalColor;
        delete el.dataset.orbitveilOriginalUserSelect;
        delete el.dataset.orbitveilProtected;
      };
      const sensitiveNames = /* @__PURE__ */ new Set([
        "full_name",
        "full-name",
        "name",
        "dob",
        "date_of_birth",
        "phone",
        "phone_number",
        "card_number",
        "card-number",
        "email",
        "password",
        "account_number",
        "credit_card"
      ]);
      const sensitiveAutocomplete = /* @__PURE__ */ new Set(["name", "email", "tel", "cc-number", "new-password", "current-password"]);
      const elements = [...document.querySelectorAll("input, textarea, select, img")];
      let protectedCount = 0;
      for (const el of elements) {
        if (el.tagName && el.tagName.toLowerCase() === "img") {
          if (el.id === "profile-photo" || (el.alt || "").toLowerCase().includes("photo")) {
            mark(el);
            protectedCount++;
            continue;
          }
        }
        const type = (el.getAttribute("type") || "").toLowerCase();
        const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        const id = (el.getAttribute("id") || "").toLowerCase();
        const matches = type === "password" || sensitiveAutocomplete.has(autocomplete) || sensitiveNames.has(name) || sensitiveNames.has(id);
        if (matches) {
          mark(el);
          protectedCount++;
        }
      }
      return { protected: protectedCount };
    }
  });
  return result || { protected: 0 };
}
async function getDomSummaryFromActiveTab(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const elements = document.querySelectorAll("input, textarea, select, button, a");
      const summary = [];
      elements.forEach((el, index) => {
        const getLabel = (el2) => {
          if (el2.id) {
            const label = document.querySelector(`label[for="${el2.id}"]`);
            if (label) return label.textContent.trim();
          }
          const parentLabel = el2.closest("label");
          if (parentLabel) return parentLabel.textContent.trim();
          return null;
        };
        summary.push({
          index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || null,
          name: el.getAttribute("name") || null,
          id: el.getAttribute("id") || null,
          placeholder: el.getAttribute("placeholder") || null,
          label: getLabel(el)
        });
      });
      return summary;
    }
  });
  return result;
}
async function getPiiDetectionsFromActiveTab(tab, imageWidth, imageHeight) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [imageWidth, imageHeight],
    func: (imageWidth2, imageHeight2) => {
      const PII_AUTOCOMPLETE = /* @__PURE__ */ new Set(["name", "email", "tel", "cc-number", "new-password"]);
      const PII_TYPES = /* @__PURE__ */ new Set(["password"]);
      const PII_KEYWORDS = ["name", "email", "phone", "tel", "password", "card", "credit"];
      const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
      const PHONE_REGEX = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\d{5}[\s.-]?\d{5}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})\b/g;
      const CARD_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;
      function cssRectToScreenshotRect(rect) {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const scaleX = imageWidth2 / vw;
        const scaleY = imageHeight2 / vh;
        return {
          x: Math.round(rect.left * scaleX),
          y: Math.round(rect.top * scaleY),
          width: Math.round(rect.width * scaleX),
          height: Math.round(rect.height * scaleY)
        };
      }
      function detectPIIElement(el) {
        const type = (el.getAttribute("type") || "").toLowerCase();
        const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        const id = (el.getAttribute("id") || "").toLowerCase();
        if (PII_TYPES.has(type)) return { type: "password", confidence: 1 };
        if (PII_AUTOCOMPLETE.has(autocomplete)) return { type: autocomplete, confidence: 1 };
        const identifier = `${name} ${id}`;
        for (const kw of PII_KEYWORDS) {
          if (identifier.includes(kw)) return { type: kw, confidence: 0.9 };
        }
        return null;
      }
      function passesLuhnCheck(candidate) {
        const digits = candidate.replace(/[ -]/g, "");
        let sum = 0, dbl = false;
        for (let i = digits.length - 1; i >= 0; i--) {
          let d = Number(digits[i]);
          if (dbl) {
            d *= 2;
            if (d > 9) d -= 9;
          }
          sum += d;
          dbl = !dbl;
        }
        return sum % 10 === 0;
      }
      const detected = [];
      document.querySelectorAll("input, textarea, select").forEach((el) => {
        const result2 = detectPIIElement(el);
        if (!result2) return;
        const rect = cssRectToScreenshotRect(el.getBoundingClientRect());
        if (rect.width <= 0 || rect.height <= 0) return;
        detected.push({ type: result2.type, source: "dom", confidence: result2.confidence, ...rect });
      });
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent) continue;
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (parent.closest("input, textarea, select")) continue;
        const text = node.textContent;
        if (!text || !text.trim()) continue;
        for (const m of text.matchAll(EMAIL_REGEX)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rect = cssRectToScreenshotRect(range.getBoundingClientRect());
          if (rect.width > 0 && rect.height > 0) detected.push({ type: "email", source: "regex", confidence: 0.95, ...rect });
        }
        for (const m of text.matchAll(PHONE_REGEX)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rect = cssRectToScreenshotRect(range.getBoundingClientRect());
          if (rect.width > 0 && rect.height > 0) detected.push({ type: "phone", source: "regex", confidence: 0.9, ...rect });
        }
        for (const m of text.matchAll(CARD_REGEX)) {
          const digits = m[0].replace(/[ -]/g, "");
          if (digits.length < 13 || digits.length > 19 || !passesLuhnCheck(m[0])) continue;
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rect = cssRectToScreenshotRect(range.getBoundingClientRect());
          if (rect.width > 0 && rect.height > 0) detected.push({ type: "card", source: "regex", confidence: 0.95, ...rect });
        }
      }
      const seen = /* @__PURE__ */ new Set();
      return detected.filter((d) => {
        const key = [d.type, d.x, d.y, d.width, d.height].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  });
  return result;
}
var DEBUG_OPEN_RAW_CAPTURE = false;
var debugCaptureShown = false;
var DEBUG_OPEN_REDACTED_CAPTURE = false;
var debugRedactedCaptureShown = false;
async function getRedactedImageAndDetections(tab) {
  const localStart = performance.now();
  const screenshotB64 = await captureScreenshot();
  console.log(`[Benchmark] Screenshot capture: ${(performance.now() - localStart).toFixed(2)} ms`);
  if (DEBUG_OPEN_RAW_CAPTURE && !debugCaptureShown) {
    debugCaptureShown = true;
    chrome.tabs.create({ url: `data:image/png;base64,${screenshotB64}` });
  }
  const dataUrl = `data:image/png;base64,${screenshotB64}`;
  const faceStart = performance.now();
  const { result: { boxes: faces }, dims } = await detectFacesViaOffscreen(dataUrl);
  const faceEnd = performance.now();
  const faceDetectionMs = faceEnd - faceStart;
  console.log(
    `[Benchmark] Face detection: ${faceDetectionMs.toFixed(2)} ms`
  );
  console.log(
    `[getRedactedImageAndDetections] captured screenshot: ${dims.width}x${dims.height}, faces found: ${faces.length}`
  );
  const piiStart = performance.now();
  const pii = await getPiiDetectionsFromActiveTab(
    tab,
    dims.width,
    dims.height
  );
  const piiEnd = performance.now();
  const piiScanMs = piiEnd - piiStart;
  console.log(
    `[Benchmark] PII scanning: ${piiScanMs.toFixed(2)} ms`
  );
  console.log("[Eval] PII detections:", JSON.stringify(pii, null, 2));
  const redactionStart = performance.now();
  const { redactedScreenshot, redactions } = await redactScreenshotViaOffscreen(
    screenshotB64,
    faces,
    pii
  );
  const redactionEnd = performance.now();
  const redactionMs = redactionEnd - redactionStart;
  console.log(
    `[Benchmark] Redaction: ${redactionMs.toFixed(2)} ms`
  );
  console.log(`Redacted ${redactions.faces} face(s), ${redactions.pii} PII region(s)`);
  if (DEBUG_OPEN_REDACTED_CAPTURE && !debugRedactedCaptureShown) {
    debugRedactedCaptureShown = true;
    chrome.tabs.create({ url: redactedScreenshot });
  }
  const base64Prefix = "base64,";
  const idx = redactedScreenshot.indexOf(base64Prefix);
  const localEnd = performance.now();
  const localProcessingMs = localEnd - localStart;
  console.log(
    `[Benchmark] Total local processing: ${localProcessingMs.toFixed(2)} ms`
  );
  return { imageB64: redactedScreenshot.slice(idx + base64Prefix.length), redactions };
}
async function executeAction(tab, action) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: executeActionInPage,
      args: [action]
    });
    if (!result || !result.success) {
      console.warn("Action execution reported failure:", result?.error);
    }
    return result || { success: false, error: "No result returned from executeScript." };
  } catch (err) {
    console.error("executeAction threw:", err);
    return { success: false, error: err.message };
  }
}
var MAX_STEPS = 15;
var stopRequested = false;
async function runAutomationLoop(taskDescription, onProgress = () => {
}) {
  stopRequested = false;
  let detectionCache = null;
  onProgress("Starting session...");
  const { session_id } = await startSession(taskDescription);
  console.log("Session started:", session_id);
  let consecutiveWaits = 0;
  const MAX_CONSECUTIVE_WAITS = 3;
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (stopRequested) {
        onProgress("Stopped by user.");
        return { status: "stopped", steps: step - 1 };
      }
      onProgress(`Step ${step}: reading page...`);
      const tab = await getActiveTab();
      const tabFingerprint = `${tab.id}:${tab.url || ""}`;
      if (!detectionCache || detectionCache.tabId !== tab.id || detectionCache.tabFingerprint !== tabFingerprint) {
        onProgress(`Step ${step}: detecting faces & PII...`);
        detectionCache = {
          tabId: tab.id,
          tabFingerprint,
          ...await getRedactedImageAndDetections(tab)
        };
      }
      const { imageB64: redactedImageB64, redactions } = detectionCache;
      const liveProtection = await applyLiveRedaction(tab, redactions);
      console.log("Live page protection applied:", liveProtection);
      const domSummaryRaw = await getDomSummaryFromActiveTab(tab);
      const domSummary = JSON.stringify(domSummaryRaw);
      onProgress(`Step ${step}: redacted ${redactions.faces} face(s), ${redactions.pii} PII region(s). Analyzing...`);
      let result;
      try {
        const serverStart = performance.now();
        result = await stepSession(
          session_id,
          domSummary,
          redactedImageB64
        );
        const serverEnd = performance.now();
        const serverRoundTripMs = serverEnd - serverStart;
        console.log(
          `[Benchmark] Server round trip: ${serverRoundTripMs.toFixed(2)} ms`
        );
      } catch (err) {
        console.error("Loop stopped on error:", err);
        onProgress(`Error: ${err.message}`);
        return { status: "error", error: err.message };
      }
      const { action, status } = result;
      console.log(`Step ${step}:`, action);
      if (status === "error") {
        onProgress("Server marked session as errored.");
        return { status: "error", error: "Server marked session as errored." };
      }
      if (action.type === "done") {
        onProgress("Done!");
        return { status: "done", steps: step };
      }
      if (action.type === "wait") {
        consecutiveWaits++;
        if (consecutiveWaits >= MAX_CONSECUTIVE_WAITS) {
          onProgress(`Stuck: ${consecutiveWaits} consecutive "wait" actions, stopping early.`);
          return { status: "stuck_on_wait", steps: step };
        }
      } else {
        consecutiveWaits = 0;
      }
      onProgress(`Step ${step}: performing ${action.type} on ${action.target || "page"}...`);
      const actionStart = performance.now();
      await executeAction(tab, action);
      const actionEnd = performance.now();
      const actionExecutionMs = actionEnd - actionStart;
      console.log(
        `[Benchmark] Action execution: ${actionExecutionMs.toFixed(2)} ms`
      );
      await new Promise((r) => setTimeout(r, 800));
    }
    onProgress(`Reached max steps (${MAX_STEPS}) without completion.`);
    return { status: "max_steps_reached" };
  } finally {
    await deleteSession(session_id);
  }
}
self.runAutomationLoop = runAutomationLoop;
var currentRunPromise = null;
var autoProtectedTabs = /* @__PURE__ */ new Set();
async function autoProtectTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !/^(https?|file):\/\//.test(tab.url)) return;
    const { redactions } = await getRedactedImageAndDetections(tab);
    const shouldBlur = (redactions?.faces || 0) > 0 || (redactions?.pii || 0) > 0;
    if (!shouldBlur) return;
    const result = await applyLiveRedaction(tab, redactions);
    console.log("Auto protection triggered by model detection:", result);
  } catch (err) {
    console.warn("Auto protection failed:", err?.message || err);
  }
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url || !/^(https?|file):\/\//.test(tab.url)) return;
  if (changeInfo.status === "loading") {
    autoProtectedTabs.delete(tabId);
    return;
  }
  if (changeInfo.status !== "complete") return;
  if (autoProtectedTabs.has(tabId)) return;
  autoProtectedTabs.add(tabId);
  setTimeout(() => {
    autoProtectTab(tabId).catch(() => {
    });
  }, 500);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  autoProtectedTabs.delete(tabId);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_TASK") {
    if (currentRunPromise) {
      sendResponse({ started: false, error: "A task is already running." });
      return false;
    }
    currentRunPromise = runAutomationLoop(message.taskDescription, (status) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", status }).catch(() => {
      });
    }).then((result) => {
      chrome.runtime.sendMessage({ type: "TASK_DONE", result }).catch(() => {
      });
    }).catch((err) => {
      chrome.runtime.sendMessage({ type: "TASK_DONE", result: { status: "error", error: err.message } }).catch(() => {
      });
    }).finally(() => {
      currentRunPromise = null;
    });
    sendResponse({ started: true });
    return false;
  }
  if (message.type === "IS_RUNNING") {
    sendResponse({ running: currentRunPromise !== null });
    return false;
  }
  if (message.type === "STOP_TASK") {
    stopRequested = true;
    sendResponse({ stopping: true });
    return false;
  }
});
