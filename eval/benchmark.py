"""
Server-only benchmark harness (Person 6 task).
Uses the real /session/start -> /session/{id}/step flow so the VLM gets
proper action history between steps, instead of re-deciding the same
first action forever. Still doesn't need the extension - once
capture/redact are wired in, swap make_blank_test_image_b64() for a real
screenshot from the browser.

Usage:
    python eval/benchmark.py
"""
import time
import json
import base64
import io
import requests
from PIL import Image

SERVER_BASE_URL = "http://localhost:8000"
TASK_DESCRIPTION = "Fill in the bio and favorite color fields, then submit."

# Placeholder DOM summary until the extension can produce a real one
# from demo/demo-form.html. Update this once dom-summary.js exists.
FAKE_DOM_SUMMARY = """
<form>
  <input type="text" name="full_name" autocomplete="name">
  <input type="email" name="email" autocomplete="email">
  <input type="tel" name="phone" autocomplete="tel">
  <input type="password" name="password" autocomplete="new-password">
  <input type="text" name="card_number" autocomplete="cc-number">
  <textarea name="bio"></textarea>
  <select name="favorite_color">
    <option>blue</option><option>green</option><option>red</option>
  </select>
  <button type="submit">Submit</button>
</form>
"""

def make_blank_test_image_b64():
    img = Image.new("RGB", (400, 300), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def run_benchmark(max_steps: int = 10, delay_between_steps: float = 2.5):
    print(f"Benchmarking against {SERVER_BASE_URL}")
    print(f"Task: {TASK_DESCRIPTION}\n")

    # Start a real session so history accumulates server-side
    start_resp = requests.post(
        f"{SERVER_BASE_URL}/session/start",
        json={"task_description": TASK_DESCRIPTION},
        timeout=30,
    )
    start_resp.raise_for_status()
    session_id = start_resp.json()["session_id"]
    print(f"Session: {session_id}\n")

    image_b64 = make_blank_test_image_b64()
    results = []
    consecutive_waits = 0
    last_action = None

    for step in range(1, max_steps + 1):
        print(f"--- Step {step} ---")
        start = time.time()
        try:
            resp = requests.post(
                f"{SERVER_BASE_URL}/session/{session_id}/step",
                json={"dom_summary": FAKE_DOM_SUMMARY, "redacted_image_b64": image_b64},
                timeout=45,
            )
            elapsed_ms = (time.time() - start) * 1000
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"  ERROR: {e}")
            break

        action = resp.json()["action"]
        print(f"  Latency: {round(elapsed_ms, 1)} ms")
        print(f"  Action: {action['type']} -> {action.get('target')}")
        print(f"  Reasoning: {action.get('reasoning')}\n")

        results.append({
            "step": step,
            "elapsed_ms": round(elapsed_ms, 1),
            "action_type": action["type"],
            "target": action.get("target"),
        })

        if action["type"] == "done":
            print("Agent signaled completion.")
            break

        if action["type"] == "wait":
            consecutive_waits += 1
            if action == last_action or consecutive_waits >= 3:
                print("Stopping benchmark: repeated wait actions indicate the model is stalling.")
                break
        else:
            consecutive_waits = 0

        last_action = action

        # Be polite to Groq's free-tier rate limit between steps
        time.sleep(delay_between_steps)
    else:
        print(f"WARNING: hit max_steps ({max_steps}) without 'done' — possible loop.")

    # Summary
    total_time = sum(r["elapsed_ms"] for r in results)
    print("\n=== Summary ===")
    print(f"Session: {session_id}")
    print(f"Total steps: {len(results)}")
    print(f"Total time: {round(total_time, 1)} ms")
    print(f"Avg time/step: {round(total_time / len(results), 1) if results else 0} ms")

    with open("eval/benchmark_output.json", "w") as f:
        json.dump({"session_id": session_id, "steps": results}, f, indent=2)
    print("\nSaved raw results to eval/benchmark_output.json")

if __name__ == "__main__":
    run_benchmark()
