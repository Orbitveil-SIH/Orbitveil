import { analyze } from "../utils/protocol.js";
import { captureScreenshot } from "../content/capture.js";
import { getDomSummary } from "../utils/dom-summary.js";

// NOTE: detectFaces and redactScreenshot are intentionally NOT imported
// here. MediaPipe's internal WASM loading uses dynamic import(), which
// Chrome disallows inside ServiceWorkerGlobalScope ("import() is
// disallowed on ServiceWorkerGlobalScope"), and redactor.js separately
// relies on `new Image()` and `document.createElement("canvas")`, which
// don't exist in ServiceWorkerGlobalScope either (no DOM there). Both
// instead run inside an Offscreen Document (offscreen.html/offscreen.js),
// which is a regular page context that supports dynamic import, canvas,
// createImageBitmap, Image, etc. See ensureOffscreenDocument() /
// detectFacesViaOffscreen() / redactScreenshotViaOffscreen() below.

const SERVER_BASE_URL = "https://omen-omen-recite.ngrok-free.dev";

async function startSession(taskDescription) {
  const res = await fetch(`${SERVER_BASE_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_description: taskDescription }),
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
      redacted_image_b64: redactedImageB64,
    }),
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

// --- Active tab targeting -------------------------------------------------
// Uses windowType: "normal" instead of currentWindow/lastFocusedWindow.
// Both of those depend on which window Chrome considers "focused" at the
// exact moment this runs, which is ambiguous when triggered from a
// DevTools console (DevTools windows have no tabs and can steal focus
// tracking). windowType: "normal" sidesteps this entirely - it just finds
// the active tab in any regular browser window, regardless of what has
// focus. This also matches how a real user will trigger this: by
// clicking the extension's popup, which is the intended flow, not the
// service worker console (that's a developer testing shortcut only).

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  if (!tabs || tabs.length === 0) {
    throw new Error("No active tab found. Open a page in a normal browser window first.");
  }
  return tabs[0];
}

// --- Offscreen document management -----------------------------------
// Face detection can't run in the service worker (see note at top of
// file), so we delegate it to an offscreen document instead.

const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Run on-device face detection (MediaPipe) which requires dynamic import() and canvas APIs unavailable in the service worker.",
  });
}

async function detectFacesViaOffscreen(dataUrl) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_DETECT_FACES",
    dataUrl,
  });
  if (!response || !response.ok) {
    throw new Error(`Offscreen face detection failed: ${response?.error || "unknown error"}`);
  }
  return response; // { ok, result: { boxes, inferenceMs }, dims: { width, height } }
}

async function redactScreenshotViaOffscreen(screenshotB64, faces, pii) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_REDACT_SCREENSHOT",
    screenshotB64,
    faces,
    pii,
  });
  if (!response || !response.ok) {
    throw new Error(`Offscreen redaction failed: ${response?.error || "unknown error"}`);
  }
  return response.result; // { redactedScreenshot, redactions }
}

async function getDomSummaryFromActiveTab(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const elements = document.querySelectorAll("input, textarea, select, button, a");
      const summary = [];
      elements.forEach((el, index) => {
        const getLabel = (el) => {
          if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) return label.textContent.trim();
          }
          const parentLabel = el.closest("label");
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
          label: getLabel(el),
        });
      });
      return summary;
    },
  });
  return result;
}

async function getPiiDetectionsFromActiveTab(tab, imageWidth, imageHeight) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [imageWidth, imageHeight],
    func: (imageWidth, imageHeight) => {
      const PII_AUTOCOMPLETE = new Set(["name", "email", "tel", "cc-number", "new-password"]);
      const PII_TYPES = new Set(["password"]);
      const PII_KEYWORDS = ["name", "email", "phone", "tel", "password", "card", "credit"];
      const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
      const PHONE_REGEX = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\d{5}[\s.-]?\d{5}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})\b/g;
      const CARD_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;

      function cssRectToScreenshotRect(rect) {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const scaleX = imageWidth / vw;
        const scaleY = imageHeight / vh;
        return {
          x: Math.round(rect.left * scaleX),
          y: Math.round(rect.top * scaleY),
          width: Math.round(rect.width * scaleX),
          height: Math.round(rect.height * scaleY),
        };
      }

      function detectPIIElement(el) {
        const type = (el.getAttribute("type") || "").toLowerCase();
        const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        const id = (el.getAttribute("id") || "").toLowerCase();
        if (PII_TYPES.has(type)) return { type: "password", confidence: 1.0 };
        if (PII_AUTOCOMPLETE.has(autocomplete)) return { type: autocomplete, confidence: 1.0 };
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
          if (dbl) { d *= 2; if (d > 9) d -= 9; }
          sum += d; dbl = !dbl;
        }
        return sum % 10 === 0;
      }

      const detected = [];

      document.querySelectorAll("input, textarea, select").forEach((el) => {
        const result = detectPIIElement(el);
        if (!result) return;
        const rect = cssRectToScreenshotRect(el.getBoundingClientRect());
        if (rect.width <= 0 || rect.height <= 0) return;
        detected.push({ type: result.type, source: "dom", confidence: result.confidence, ...rect });
      });

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
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
          if (rect.width > 0 && rect.height > 0) detected.push({ type: "phone", source: "regex", confidence: 0.90, ...rect });
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

      const seen = new Set();
      return detected.filter((d) => {
        const key = [d.type, d.x, d.y, d.width, d.height].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });
  return result;
}

// DEBUG: set to true to visually inspect exactly what captureScreenshot()
// actually captured, by opening it in a new tab as a data URL. This is
// the ONLY way to confirm whether a face photo was in the visible
// viewport at capture time - chrome.tabs.captureVisibleTab only grabs
// what's on-screen, not the full scrollable page. Flip back to false
// once face detection is confirmed working (leaving it on will open a
// new tab on every single step of every run).
const DEBUG_OPEN_RAW_CAPTURE = true;
let debugCaptureShown = false;

async function getRedactedImageAndDetections(tab) {
  const screenshotB64 = await captureScreenshot();

  if (DEBUG_OPEN_RAW_CAPTURE && !debugCaptureShown) {
    debugCaptureShown = true;
    chrome.tabs.create({ url: `data:image/png;base64,${screenshotB64}` });
  }

  const dataUrl = `data:image/png;base64,${screenshotB64}`;
  const { result: { boxes: faces }, dims } = await detectFacesViaOffscreen(dataUrl);
  console.log(`[getRedactedImageAndDetections] captured screenshot: ${dims.width}x${dims.height}, faces found: ${faces.length}`);

  const pii = await getPiiDetectionsFromActiveTab(tab, dims.width, dims.height);

  const { redactedScreenshot, redactions } = await redactScreenshotViaOffscreen(screenshotB64, faces, pii);
  console.log(`Redacted ${redactions.faces} face(s), ${redactions.pii} PII region(s)`);

  const base64Prefix = "base64,";
  const idx = redactedScreenshot.indexOf(base64Prefix);
  return { imageB64: redactedScreenshot.slice(idx + base64Prefix.length), redactions };
}

// TODO(Aparna): executor.js is currently empty. Once it exists, replace
// this stub with: import { executeAction } from "../content/executor.js"
// and inject it via chrome.scripting.executeScript against the active tab.

async function executeAction(tab, action) {
  console.log("Would execute action on tab", tab.id, ":", action);
  return { success: true };
}

const MAX_STEPS = 15;

let stopRequested = false;

// onProgress(status) is called at each stage so the popup can show live
// status text. status is a short string, e.g. "Capturing screen...".
async function runAutomationLoop(taskDescription, onProgress = () => {}) {
  stopRequested = false;
  onProgress("Starting session...");
  const { session_id } = await startSession(taskDescription);
  console.log("Session started:", session_id);

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (stopRequested) {
        onProgress("Stopped by user.");
        return { status: "stopped", steps: step - 1 };
      }
      onProgress(`Step ${step}: reading page...`);
      const tab = await getActiveTab();

      const domSummaryRaw = await getDomSummaryFromActiveTab(tab);
      const domSummary = JSON.stringify(domSummaryRaw);

      onProgress(`Step ${step}: detecting faces & PII...`);
      const { imageB64: redactedImageB64, redactions } = await getRedactedImageAndDetections(tab);

      onProgress(`Step ${step}: redacted ${redactions.faces} face(s), ${redactions.pii} PII region(s). Analyzing...`);

      let result;
      try {
        result = await stepSession(session_id, domSummary, redactedImageB64);
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

      onProgress(`Step ${step}: performing ${action.type} on ${action.target || "page"}...`);
      await executeAction(tab, action);
      await new Promise((r) => setTimeout(r, 800));
    }

    onProgress(`Reached max steps (${MAX_STEPS}) without completion.`);
    return { status: "max_steps_reached" };
  } finally {
    await deleteSession(session_id);
  }
}

self.runAutomationLoop = runAutomationLoop;

// --- Message listener for popup communication ------------------------
// The popup can't call runAutomationLoop() directly (different execution
// context), so it sends a message instead. We run the loop here and
// broadcast progress/completion back via chrome.runtime.sendMessage,
// which the popup listens for. If the popup is closed mid-run, these
// sends will just fail silently (.catch(() => {})) - the loop keeps
// running regardless, it just has no UI to report to anymore.

let currentRunPromise = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_TASK") {
    if (currentRunPromise) {
      sendResponse({ started: false, error: "A task is already running." });
      return false;
    }

    currentRunPromise = runAutomationLoop(message.taskDescription, (status) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", status }).catch(() => {});
    })
      .then((result) => {
        chrome.runtime.sendMessage({ type: "TASK_DONE", result }).catch(() => {});
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ type: "TASK_DONE", result: { status: "error", error: err.message } }).catch(() => {});
      })
      .finally(() => {
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