// extension/src/vision/face-detector.js
//
// Owner: Person 2 (Arya)
// Runs entirely on-device (WASM, no network call) â€” matches the PS
// requirement that redaction happens before any network request.
//
// Uses MediaPipe Tasks Vision's FaceDetector with the short-range
// (BlazeFace) model â€” optimized for close-range faces (webcam/profile
// photo style), which is lighter than the full-range model and directly
// helps the client-side resource-utilization rubric metric (20%).
//
// NOTE ON BUNDLING: for the actual extension build, don't load the WASM
// or model from a CDN â€” Manifest V3's default CSP blocks remote code
// execution for extensions. Download these once and ship them inside
// the extension package:
//   - WASM assets: node_modules/@mediapipe/tasks-vision/wasm/*  -> extension/wasm/
//   - Model file:  blaze_face_short_range.tflite                -> extension/models/
// (See standalone-test.html in this folder for a CDN-based version you
// can run right now in a plain browser tab, no extension needed.)

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_BASE_URL = chrome.runtime.getURL("wasm");
const MODEL_URL = chrome.runtime.getURL("models/blaze_face_short_range.tflite");

let detectorInstance = null;
let detectorLoadingPromise = null;

/**
 * Lazily creates (once) and returns the MediaPipe FaceDetector instance.
 * Subsequent calls reuse the same instance â€” model load is the expensive
 * part, so we only pay that cost once per content-script lifetime.
 */
async function getDetector() {
  if (detectorInstance) return detectorInstance;
  if (detectorLoadingPromise) return detectorLoadingPromise;

  detectorLoadingPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    detectorInstance = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        // "GPU" uses WebGL/WebGPU when available and silently falls back
        // to CPU otherwise â€” good default for resource-constrained laptops.
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
    // DEBUG: confirms the model actually finished loading. If this never
    // logs, getDetector() is hanging or throwing before this point.
    console.log("[face-detector] detector loaded OK, model:", MODEL_URL);
    return detectorInstance;
  })();

  return detectorLoadingPromise;
}

/**
 * Converts the base64 screenshot data URL that Harisha's capture.js
 * produces into an ImageBitmap MediaPipe can read.
 */
async function base64ToImageBitmap(base64DataUrl) {
  const res = await fetch(base64DataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/**
 * Detects faces in a base64 screenshot.
 *
 * @param {string} base64Screenshot - data URL, e.g. "data:image/png;base64,..."
 * @returns {Promise<{ boxes: Array<{x:number,y:number,width:number,height:number,confidence:number}>, inferenceMs: number }>}
 *
 * `boxes` is the exact shape agreed with Dilkush's redactor â€” see
 * face-detector-handoff.md for the writeup.
 */
export async function detectFaces(base64Screenshot) {
  const detector = await getDetector();
  const imageBitmap = await base64ToImageBitmap(base64Screenshot);

  // DEBUG: confirms (a) the image actually decoded to real pixels, and
  // (b) how many raw detections MediaPipe found before any of our own
  // filtering. If width/height look wrong, the captured screenshot
  // itself is the problem, not the detector. Remove once face detection
  // is confirmed working end-to-end.
  console.log(`[face-detector] input bitmap: ${imageBitmap.width}x${imageBitmap.height}`);

  const t0 = performance.now();
  const result = detector.detect(imageBitmap);
  const t1 = performance.now();
  const inferenceMs = t1 - t0;

  console.log(`[face-detector] raw detections: ${result.detections?.length ?? 0}`, result.detections);

  const boxes = (result.detections || []).map((d) => {
    const bb = d.boundingBox;
    const confidence = d.categories?.[0]?.score ?? null;
    return {
      x: Math.round(bb.originX),
      y: Math.round(bb.originY),
      width: Math.round(bb.width),
      height: Math.round(bb.height),
      confidence: confidence !== null ? Number(confidence.toFixed(3)) : null,
    };
  });

  imageBitmap.close?.();

  return { boxes, inferenceMs };
}

/**
 * Runs detection `runs` times on the same image and reports timing
 * stats. Feeds the client-side resource-utilization (20%) and
 * end-to-end latency (15%) rubric metrics â€” hand this output to Aakash
 * for eval/results.md.
 *
 * @param {string} base64Screenshot
 * @param {number} runs
 */
export async function benchmarkFaceDetection(base64Screenshot, runs = 10) {
  await getDetector(); // warm up / load model once, outside timing loop
  const timings = [];
  let lastBoxes = [];

  for (let i = 0; i < runs; i++) {
    const { boxes, inferenceMs } = await detectFaces(base64Screenshot);
    timings.push(inferenceMs);
    lastBoxes = boxes;
  }

  timings.sort((a, b) => a - b);
  const avg = timings.reduce((s, v) => s + v, 0) / timings.length;
  const median = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))];

  return {
    runs,
    avgMs: Number(avg.toFixed(2)),
    medianMs: Number(median.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    minMs: Number(timings[0].toFixed(2)),
    maxMs: Number(timings[timings.length - 1].toFixed(2)),
    lastDetectionBoxes: lastBoxes,
  };
}