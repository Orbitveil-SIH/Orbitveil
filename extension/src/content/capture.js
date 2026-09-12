async function captureScreenshot() {
  // Force scroll to top before capturing - otherwise PII/face bounding
  // boxes computed from getBoundingClientRect() (viewport-relative) end
  // up with negative or offset coordinates relative to the actual
  // captured screenshot, causing redaction boxes to be misplaced or
  // missing, and can scroll faces/fields entirely out of frame.
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowType: "normal" });
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollTo(0, 0),
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

export { captureScreenshot };
