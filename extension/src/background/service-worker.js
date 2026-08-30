import { analyze } from "../utils/protocol.js";
import { captureScreenshot } from "../content/capture.js";
import { redactScreenshot } from "../vision/redactor.js";

async function getRedactedImage() {
  const screenshotB64 = await captureScreenshot();
  const result = await redactScreenshot(screenshotB64);
  return result.redactedScreenshot;
}
async function getDomSummaryFromPage() {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => t.url && t.url.includes("google.com"));
  if (!tab) {
    throw new Error("No active tab found.");
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const elements = document.querySelectorAll("input, textarea, select, button, a");
      const summary = [];
      elements.forEach((el, index) => {
        summary.push({
          index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || null,
          name: el.getAttribute("name") || null,
          id: el.getAttribute("id") || null,
          placeholder: el.getAttribute("placeholder") || null,
        });
      });
      return summary;
    },
  });
  return result;
}
async function executeAction(action) {
  // TODO: hand off to executor.js once it exists
  console.log("Would execute action:", action);
}

async function runAutomationLoop(taskDescription) {
  while (true) {
    const domSummaryRaw = await getDomSummaryFromPage();
    const domSummary = JSON.stringify(domSummaryRaw);
    const redactedImageB64 = await getRedactedImage();

    let result;
    try {
      result = await analyze(taskDescription, domSummary, redactedImageB64);
    } catch (err) {
      console.error("Loop stopped on error:", err);
      return { status: "error", error: err.message };
    }
    const { action } = result;
    if (action.type === "done") {
      return { status: "done" };
    }

    await executeAction(action);
    await new Promise((r) => setTimeout(r, 800));
  }
}
self.runAutomationLoop = runAutomationLoop;
