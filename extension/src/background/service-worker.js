import { analyze } from "../utils/protocol.js";

// TODO: replace with real dom-summary.js output once available

async function getDomSummary() {
  // Placeholder for now — swap in real DOM capture logic later
  return "<input type=text placeholder=Search>";
}
// TODO: replace with real redactor.js output once vision pipeline is ready
async function getRedactedImage() {

  // Placeholder base64 from the corrected todo doc — swap in real pipeline output later
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
}
async function executeAction(action) {
  // TODO: hand off to executor.js once it exists
  console.log("Would execute action:", action);
}
async function runAutomationLoop(taskDescription) {
  while (true) {
    const domSummary = await getDomSummary();
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
