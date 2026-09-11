const SERVER_BASE_URL = "http://localhost:8000";
export async function analyze(taskDescription, domSummary, redactedImageB64) {
  const response = await fetch(`${SERVER_BASE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_description: taskDescription,
      dom_summary: domSummary,
      redacted_image_b64: redactedImageB64,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      `analyze() failed: ${response.status} ${errorBody.detail || response.statusText}`
    );
  }
  return response.json(); // { action: {...} }
}

