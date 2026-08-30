import { analyze } from "../utils/protocol.js";
import { getDomSummary } from "../utils/dom-summary.js";
import { captureScreenshot } from "../content/capture.js";
import { redactScreenshot } from "../vision/redactor.js";

async function getRedactedImage() {
  const screenshotB64 = await captureScreenshot();
  const result = await redactScreenshot(screenshotB64);
  return result.redactedScreenshot;
}
async function executeAction(action) {
  // TODO: hand off to executor.js once it exists
  console.log("Would execute action:", action);
}

async function runAutomationLoop(taskDescription) {
  while (true) {
    const domSummaryRaw = getDomSummary();
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
