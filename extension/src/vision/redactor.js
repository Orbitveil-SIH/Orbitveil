// extension/src/vision/redactor.js

/*
 * Screenshot Redactor
 *
 * Responsibilities:
 * 1. Decode the captured screenshot locally.
 * 2. Receive face bounding boxes from face-detector.js.
 * 3. Receive PII bounding boxes from pii-scanner.js.
 * 4. Blur detected faces.
 * 5. Black out detected PII regions.
 * 6. Return ONLY the redacted screenshot.
 *
 */


/* 
   1. CONSTANTS
*/

const FACE_BLUR_PX = 16;


/* 
   2. SCREENSHOT LOADING
   */

/**
 * Convert a base64 screenshot into an Image object.
 *
 * The capture pipeline currently uses PNG. If capture.js changes
 * the image format later, this assumption must be updated.
 *
 * Supports:
 *   data:image/png;base64,...
 * and:
 *   iVBORw0...
 *
 */
function loadScreenshot(screenshotB64) {

    return new Promise((resolve, reject) => {

        if (
            typeof screenshotB64 !== "string" ||
            screenshotB64.length === 0
        ) {
            reject(
                new Error("Invalid screenshot data.")
            );

            return;
        }

        const image = new Image();

        image.onload = () => {
            resolve(image);
        };

        image.onerror = () => {
            reject(
                new Error("Failed to decode screenshot.")
            );
        };

        if (screenshotB64.startsWith("data:image")) {

            image.src = screenshotB64;

        } else {

            // Current capture pipeline is PNG.
            image.src =
                `data:image/png;base64,${screenshotB64}`;
        }
    });
}


/* 
   3. CANVAS CREATION
  */

/**
 * Create a canvas with exactly the same dimensions
 * as the captured screenshot.
 */
function createCanvas(width, height) {

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    return canvas;
}


/* 
   4. RECTANGLE VALIDATION
    */

/**
 * Validate and clamp a detection box to the screenshot.
 * Coordinates are expected to already be in screenshot pixels.
 */
function clampRect(
    box,
    imageWidth,
    imageHeight
) {

    if (!box) {
        return null;
    }

    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
    ) {
        return null;
    }

    if (width <= 0 || height <= 0) {
        return null;
    }

    const left = Math.max(0, x);
    const top = Math.max(0, y);

    const right = Math.min(
        imageWidth,
        x + width
    );

    const bottom = Math.min(
        imageHeight,
        y + height
    );

    const clampedWidth = right - left;
    const clampedHeight = bottom - top;

    if (
        clampedWidth <= 0 ||
        clampedHeight <= 0
    ) {
        return null;
    }

    return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(clampedWidth),
        height: Math.round(clampedHeight)
    };
}


/* 
   5. FACE REDACTION
    */

/**
 * Blur only the region around a detected face.
 *
 * A padded crop is used so the blur has neighboring pixels
 * available near the face-box edges.
 */
function blurFace(
    outputContext,
    sourceCanvas,
    face,
    imageWidth,
    imageHeight
) {

    const rect = clampRect(
        face,
        imageWidth,
        imageHeight
    );

    if (!rect) {
        return false;
    }

    /*
     * Pad the source crop so the blur has real pixels
     * to sample near the face-box edges.
     */
    const sx = Math.max(
        0,
        rect.x - FACE_BLUR_PX
    );

    const sy = Math.max(
        0,
        rect.y - FACE_BLUR_PX
    );

    const sw = Math.min(
        imageWidth,
        rect.x + rect.width + FACE_BLUR_PX
    ) - sx;

    const sh = Math.min(
        imageHeight,
        rect.y + rect.height + FACE_BLUR_PX
    ) - sy;

    outputContext.save();

    outputContext.beginPath();

    outputContext.rect(
        rect.x,
        rect.y,
        rect.width,
        rect.height
    );

    outputContext.clip();

    outputContext.filter =
        `blur(${FACE_BLUR_PX}px)`;

    /*
     * Only the padded region is processed by the blur.
     */
    outputContext.drawImage(
        sourceCanvas,
        sx,
        sy,
        sw,
        sh,
        sx,
        sy,
        sw,
        sh
    );

    outputContext.filter = "none";

    outputContext.restore();

    return true;
}


/* 
   6. PII REDACTION
   */

/**
 * Cover a PII region with a solid black rectangle.
 */
function redactPII(
    context,
    pii,
    imageWidth,
    imageHeight
) {

    const rect = clampRect(
        pii,
        imageWidth,
        imageHeight
    );

    if (!rect) {
        return false;
    }

    context.fillStyle = "#000000";

    context.fillRect(
        rect.x,
        rect.y,
        rect.width,
        rect.height
    );

    return true;
}


/* 
   7. MAIN REDACTION PIPELINE
   */

/**
 * Redact a screenshot locally.
 */
async function redactScreenshot(
    screenshotB64,
    faces = [],
    pii = []
) {

    /*
     * STEP 1 — Decode the exact screenshot that will
     * eventually be transmitted in redacted form.
     */
    const image = await loadScreenshot(
        screenshotB64
    );

    /*
     * These are the authoritative dimensions of the
     * screenshot being redacted.
     */
    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;

    if (
        imageWidth <= 0 ||
        imageHeight <= 0
    ) {
        throw new Error(
            "Screenshot has invalid dimensions."
        );
    }

    /*
     * STEP 2 — Create separate source and output canvases.
     *
     * sourceCanvas:
     *     original screenshot, local only.
     *
     * outputCanvas:
     *     progressively redacted screenshot.
     */
    const sourceCanvas = createCanvas(
        imageWidth,
        imageHeight
    );

    const outputCanvas = createCanvas(
        imageWidth,
        imageHeight
    );

    const sourceContext =
        sourceCanvas.getContext("2d");

    const outputContext =
        outputCanvas.getContext("2d");

    if (!sourceContext || !outputContext) {
        throw new Error(
            "Unable to create canvas rendering context."
        );
    }

    /*
     * STEP 3 — Draw the original screenshot locally.
     */
    sourceContext.drawImage(
        image,
        0,
        0,
        imageWidth,
        imageHeight
    );

    /*
     * Start output as an exact copy.
     */
    outputContext.drawImage(
        sourceCanvas,
        0,
        0
    );

    /*
     * STEP 4 — Blur faces.
     */
    let faceRedactions = 0;

    if (Array.isArray(faces)) {

        for (const face of faces) {

            /*
             * face detector already applies its confidence
             * threshold, currently >= 0.5.
             */
            const success = blurFace(
                outputContext,
                sourceCanvas,
                face,
                imageWidth,
                imageHeight
            );

            if (success) {
                faceRedactions++;
            }
        }
    }

    /*
     * STEP 5 — Black out PII.
     */
    let piiRedactions = 0;

    if (Array.isArray(pii)) {

        for (const detection of pii) {

            const success = redactPII(
                outputContext,
                detection,
                imageWidth,
                imageHeight
            );

            if (success) {
                piiRedactions++;
            }
        }
    }

    /*
     * STEP 6 — Export ONLY the redacted canvas.
     *
     * PNG is the initial implementation. JPEG can be benchmarked
     * later as a latency/payload-size optimization.
     */
    const redactedScreenshot =
        outputCanvas.toDataURL(
            "image/png"
        );

    /*
     * STEP 7 — Return only the safe image and
     * non-sensitive redaction counts.
     *
     * The raw screenshot is intentionally not returned.
     */
    return {
        redactedScreenshot,

        redactions: {
            faces: faceRedactions,
            pii: piiRedactions
        }
    };
}


/* 
   8. EXPORTS
 */

/*
 * redactScreenshot() is the production integration entry point.
 * The lower-level exports are retained for local unit testing.
 * protocol.js should use only redactScreenshot() and send only
 * result.redactedScreenshot.
 */

export {
    redactScreenshot,
    loadScreenshot,
    createCanvas,
    clampRect,
    blurFace,
    redactPII
};
