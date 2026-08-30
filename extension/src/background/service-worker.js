import { analyze } from "../utils/protocol.js";
import { captureScreenshot } from "../content/capture.js";
import { redactScreenshot } from "../vision/redactor.js";
import { detectFaces } from "../vision/face-detector.js";
import { getDomSummary } from "../utils/dom-summary.js";

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

// NOTE: uses lastFocusedWindow instead of currentWindow. When running
// runAutomationLoop() from the extension's own service worker DevTools
// console, "currentWindow" can resolve to the DevTools window itself
// (which has no tabs), causing "No active tab found." lastFocusedWindow
// correctly targets the last focused normal browser window instead.

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    throw new Error("No active tab found.");
  }
  return tab;
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

async function getRedactedImageAndDetections(tab) {
  const screenshotB64 = await captureScreenshot();

  const dataUrl = `data:image/png;base64,${screenshotB64}`;
  const { boxes: faces } = await detectFaces(dataUrl);

  const dims = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });

  const pii = await getPiiDetectionsFromActiveTab(tab, dims.width, dims.height);

  const { redactedScreenshot, redactions } = await redactScreenshot(screenshotB64, faces, pii);
  console.log(`Redacted ${redactions.faces} face(s), ${redactions.pii} PII region(s)`);

  const base64Prefix = "base64,";
  const idx = redactedScreenshot.indexOf(base64Prefix);
  return redactedScreenshot.slice(idx + base64Prefix.length);
}

// TODO(Aakash): executor.js is currently empty. Once it exists, replace
// this stub with: import { executeAction } from "../content/executor.js"

async function executeAction(tab, action) {
  console.log("Would execute action on tab", tab.id, ":", action);
  return { success: true };
}

const MAX_STEPS = 15;

async function runAutomationLoop(taskDescription) {
  const { session_id } = await startSession(taskDescription);
  console.log("Session started:", session_id);

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const tab = await getActiveTab();

      const domSummaryRaw = await getDomSummaryFromActiveTab(tab);
      const domSummary = JSON.stringify(domSummaryRaw);

      const redactedImageB64 = await getRedactedImageAndDetections(tab);

      let result;
      try {
        result = await stepSession(session_id, domSummary, redactedImageB64);
      } catch (err) {
        console.error("Loop stopped on error:", err);
        return { status: "error", error: err.message };
      }

      const { action, status } = result;
      console.log(`Step ${step}:`, action);

      if (status === "error") {
        return { status: "error", error: "Server marked session as errored." };
      }
      if (action.type === "done") {
        return { status: "done", steps: step };
      }

      await executeAction(tab, action);
      await new Promise((r) => setTimeout(r, 800));
    }

    console.warn(`Hit MAX_STEPS (${MAX_STEPS}) without completion.`);
    return { status: "max_steps_reached" };
  } finally {
    await deleteSession(session_id);
  }
}

self.runAutomationLoop = runAutomationLoop;