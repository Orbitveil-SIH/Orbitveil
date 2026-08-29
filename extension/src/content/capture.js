// capture.js
// Takes a fresh screenshot of the current browser tab every time it's called.
// No caching — always returns the current state.
// Does NOT send anything anywhere, does NOT redact anything.

/**
 * Captures a screenshot of the currently active browser tab.
 * @returns {Promise<string>} base64-encoded PNG image (no "data:image/png;base64," prefix)
 */
async function captureScreenshot() {
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

export { captureScreenshot };
