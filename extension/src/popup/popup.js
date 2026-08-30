const taskInput = document.getElementById("taskInput");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");

function setStatus(text, cssClass) {
  statusEl.textContent = text;
  statusEl.className = cssClass;
}

function appendStatus(text) {
  statusEl.textContent += "\n" + text;
  statusEl.className = "status-running";
  statusEl.scrollTop = statusEl.scrollHeight;
}

function setRunningUI(isRunning) {
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  taskInput.disabled = isRunning;
}

// Listen for progress/completion messages pushed from the service worker.
// Note: since this is a popup, it only receives these while open. If the
// user closes the popup mid-task, the loop keeps running in the
// background regardless (see service-worker.js comments) but this UI
// simply won't show further updates until reopened.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PROGRESS") {
    appendStatus(message.status);
  }
  if (message.type === "TASK_DONE") {
    setRunningUI(false);
    const { result } = message;
    if (result.status === "done") {
      appendStatus(`✅ Done in ${result.steps} step(s).`);
      statusEl.className = "status-done";
    } else if (result.status === "stopped") {
      appendStatus(`⏹ Stopped after ${result.steps} step(s).`);
      statusEl.className = "status-idle";
    } else if (result.status === "error") {
      appendStatus(`❌ Error: ${result.error}`);
      statusEl.className = "status-error";
    } else {
      appendStatus(`Finished with status: ${result.status}`);
      statusEl.className = "status-idle";
    }
  }
});

startBtn.addEventListener("click", () => {
  const taskDescription = taskInput.value.trim();
  if (!taskDescription) {
    setStatus("Please describe a task first.", "status-error");
    return;
  }

  setStatus(`Starting: "${taskDescription}"`, "status-running");
  setRunningUI(true);

  chrome.runtime.sendMessage({ type: "START_TASK", taskDescription }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`, "status-error");
      setRunningUI(false);
      return;
    }
    if (!response || !response.started) {
      setStatus(response?.error || "Failed to start task.", "status-error");
      setRunningUI(false);
    }
  });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_TASK" });
  stopBtn.disabled = true;
});

// On popup open, check if a task is already running (e.g. popup was
// closed and reopened mid-task) so the UI reflects reality.
chrome.runtime.sendMessage({ type: "IS_RUNNING" }, (response) => {
  if (response && response.running) {
    setStatus("A task is already running...", "status-running");
    setRunningUI(true);
  }
});