// This runs inside the offscreen document, NOT the service worker.
// MediaPipe's internal WASM loading uses dynamic import(), which Chrome
// disallows inside ServiceWorkerGlobalScope. Offscreen documents are
// regular page contexts (have a DOM, can use dynamic import, canvas,
// createImageBitmap, Image, etc.), so face detection AND image
// dimension-reading both have to live here instead of the service worker.

import { detectFaces } from "../vision/face-detector.js";

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_DETECT_FACES") {
    (async () => {
      try {
        const [result, dims] = await Promise.all([
          detectFaces(message.dataUrl),
          getImageDimensions(message.dataUrl),
        ]);
        sendResponse({ ok: true, result, dims });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // keep the message channel open for the async response
  }
});