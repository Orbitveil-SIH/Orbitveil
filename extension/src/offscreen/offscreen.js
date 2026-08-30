// This runs inside the offscreen document, NOT the service worker.
// MediaPipe's internal WASM loading uses dynamic import(), which Chrome
// disallows inside ServiceWorkerGlobalScope. Offscreen documents are
// regular page contexts (have a DOM, can use dynamic import, canvas,
// createImageBitmap, etc.), so face detection has to live here instead.

import { detectFaces } from "../vision/face-detector.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_DETECT_FACES") {
    detectFaces(message.dataUrl)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
});
