"""
Server-only benchmark harness (Person 6 task, Step 3 partial version).
Tests timing + step-counting against the live /analyze server, without
needing the extension. Once the extension is ready, this gets extended
to drive the real capture -> redact -> analyze -> execute loop.

Usage:
    python eval/benchmark.py
"""
import time
import json
import base64
import io
import requests
from PIL import Image

SERVER_URL = "http://localhost:8000/analyze"
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

def run_single_call(dom_summary: str, image_b64: str) -> dict:
    payload = {
        "task_description": TASK_DESCRIPTION,
        "dom_summary": dom_summary,
        "redacted_image_b64": image_b64,
    }
    start = time.time()
    resp = requests.post(SERVER_URL, json=payload, timeout=30)
    elapsed_ms = (time.time() - start) * 1000

    resp.raise_for_status()
    return {
        "elapsed_ms": round(elapsed_ms, 1),
        "response": resp.json(),
    }

def run_benchmark(max_steps: int = 10):
    print(f"Benchmarking against {SERVER_URL}")
    print(f"Task: {TASK_DESCRIPTION}\n")

    image_b64 = make_blank_test_image_b64()
    results = []

    for step in range(1, max_steps + 1):
        print(f"--- Step {step} ---")
        try:
            result = run_single_call(FAKE_DOM_SUMMARY, image_b64)
        except requests.exceptions.RequestException as e:
            print(f"  ERROR: {e}")
            break

        action = result["response"]["action"]
        print(f"  Latency: {result['elapsed_ms']} ms")
        print(f"  Action: {action['type']} -> {action.get('target')}")
        print(f"  Reasoning: {action.get('reasoning')}\n")

        results.append({
            "step": step,
            "elapsed_ms": result["elapsed_ms"],
            "action_type": action["type"],
            "target": action.get("target"),
        })

        if action["type"] == "done":
            print("Agent signaled completion.")
            break
    else:
        print(f"WARNING: hit max_steps ({max_steps}) without 'done' — possible loop.")

    # Summary
    total_time = sum(r["elapsed_ms"] for r in results)
    print("\n=== Summary ===")
    print(f"Total steps: {len(results)}")
    print(f"Total time: {round(total_time, 1)} ms")
    print(f"Avg time/step: {round(total_time / len(results), 1) if results else 0} ms")

    with open("eval/benchmark_output.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nSaved raw results to eval/benchmark_output.json")

if __name__ == "__main__":
    run_benchmark()
