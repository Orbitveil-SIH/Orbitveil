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
