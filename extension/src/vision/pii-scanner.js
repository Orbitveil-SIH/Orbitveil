// extension/src/vision/pii-scanner.js


/*
 * PII SCANNER
 *
 * This file finds sensitive information on the webpage.
 *
 * It uses two methods:
 * 1. DOM-based detection
 * 2. Regex-based detection
 *
 * After finding PII, it finds its position on the screenshot
 * so that redactor.js knows exactly where to hide it.
 *
 * IMPORTANT:
 * We never return the actual PII value.
 * We only return information such as:
 * - what type of PII it is
 * - where it is
 * - how confident we are
 *
 * All coordinates are converted to screenshot pixels.
 */


/* 1. DOM-BASED PII RULES */
 /*
 * Some HTML form fields use the "autocomplete" attribute
 * to tell the browser what kind of information the field
 * is meant to contain and help the browser give suggestion to the user
 *
 * Example:
 *
 * <input autocomplete="email">
 *
 * This tells us that the field is meant for an email address.
 *
 * These values are strong signals that the field may contain PII.
 *
 */

const PII_AUTOCOMPLETE = new Set([
    "name",
    "email",
    "tel",
    "cc-number",
    "new-password"
]);

/*
 * Some HTML input types directly tell us that the field
 * contains sensitive information.
 *
 * The main example is:
 *
 * <input type="password">
 *
 * A password field is a very strong PII signal because
 * the purpose of this input type is specifically to hold
 * a password.
 *
 * We keep these types in a Set so we can quickly check
 * whether an element's "type" is considered sensitive.
 */


/* type
    ↓
"What KIND of input is this?"

autocomplete
   ↓
"What INFORMATION is this input meant for?"
*/

const PII_TYPES = new Set([
    "password"
]);

/*
 * Sometimes a website does not use standard HTML signals
 * like autocomplete="email" or type="password".
 *
 * In those cases, we can look at the element's "name"
 * and "id" attributes for common PII-related words.
 *
 * Examples:
 *
 * <input name="phone_number">
 * <input id="email_address">
 * <input name="credit_card">
 *
 * We can detect these because their name or id contains
 * words such as "phone", "email", or "card".
 *
 * These are weaker signals than type or autocomplete,
 * because a keyword could sometimes be used for a
 * non-sensitive field.
 *
 * That is why these detections get a slightly lower
 * confidence score later.
 */

const PII_KEYWORDS = [
    "name",
    "email",
    "phone",
    "tel",
    "password",
    "card",
    "credit"
];


/* 
   2. REGEX RULES
 */

/*
 * Regular expression used to find email addresses
 * inside normal webpage text.
 */

const EMAIL_REGEX =
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;


/*
 * for phone-number pattern.
 * We deliberately avoid matching arbitrary 7-10 digit
 * numbers because that would create many false positives.
 * The leading (?<!\d) lookbehind prevents this from matching
 * partway into a longer unbroken digit run (e.g. a 16-digit
 * card number), which would otherwise produce an overlapping
 * "phone" box on top of a "card" detection.
 */
const PHONE_REGEX =
    /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\d{5}[\s.-]?\d{5}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})\b/g;


/*
 * Regular expression used to find possible card numbers
 * Allows optional spaces/hyphens between digits.
 * Requires 13-19 digits total.
 * The pattern itself is intentionally flat to avoid
 * unnecessary regex backtracking.
 *  IMPORTANT:
 *
 * This regex only finds a CARD CANDIDATE.
 * It cannot tell for sure whether a 13-19 digit number
 * is actually a card number. Other things such as
 * tracking numbers or long IDs could look similar.
 * Therefore, every candidate is checked again using
 * the Luhn algorithm before we classify it as a card.
 */
const CARD_REGEX =
    /\b\d(?:[ -]?\d){12,18}\b/g;


/* 
   3. COORDINATE CONVERSION
  */

/**
 *  * Converts a position from the webpage's coordinate system
 * (CSS pixels) into the screenshot's coordinate system
 * (screenshot pixels).
 *
 * @param {DOMRect} rect
 * @param {number} screenshotWidth
 * @param {number} screenshotHeight
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function cssRectToScreenshotRect(
    rect,
    screenshotWidth,
    screenshotHeight
) {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    const scaleX = screenshotWidth / viewportWidth;
    const scaleY = screenshotHeight / viewportHeight;

    return {
        x: Math.round(rect.left * scaleX),
        y: Math.round(rect.top * scaleY),
        width: Math.round(rect.width * scaleX),
        height: Math.round(rect.height * scaleY)
    };
}


/*
 * After finding sensitive data, this function finds its
 * position and creates a rectangle (bounding box) around it.
 *
 * This rectangle tells the redactor exactly which area
 * of the screenshot needs to be redacted.
 */
function getElementScreenshotRect(
    element,
    screenshotWidth,
    screenshotHeight
) {
    const rect = element.getBoundingClientRect();

    return cssRectToScreenshotRect(
        rect,
        screenshotWidth,
        screenshotHeight
    );
}


/* 
   4. DOM PII DETECTION
    */

/**
 * Determine whether a form element is likely to contain PII.
 *  first check the strongest signals:
 *     1. type="password"
 *     2. autocomplete="email", "name", etc.
 *
 * If those don't match,  use the name/id keywords
 * as a weaker signal.
 *
 * If a match is found,  return the PII type and
 * a confidence score.
 *
 * If nothing matches,  return null.
 */
function detectPIIElement(element) {

    const type =
        (element.getAttribute("type") || "").toLowerCase();

    const autocomplete =
        (element.getAttribute("autocomplete") || "").toLowerCase();

    const name =
        (element.getAttribute("name") || "").toLowerCase();

    const id =
        (element.getAttribute("id") || "").toLowerCase();


    /*
     * Strongest signal:
     * type="password"
     */
    if (PII_TYPES.has(type)) {
        return {
            type: "password",
            confidence: 1.0
        };
    }


    /*
     * Strong standard HTML signal:
     * autocomplete="email"
     * autocomplete="tel"
     * etc.
     */
    if (PII_AUTOCOMPLETE.has(autocomplete)) {

        return {
            type: autocomplete,
            confidence: 1.0
        };
    }


    /*
     * Secondary signal:
     * name/id contains a sensitive keyword.
     */
    const identifier = `${name} ${id}`;

    for (const keyword of PII_KEYWORDS) {

        if (identifier.includes(keyword)) {

            return {
                type: keyword,
                confidence: 0.9
            };
        }
    }


    return null;
}


/* 
   5. FORM ELEMENT SCANNER
    */

/**
 * Scans all form elements on the webpage for PII.
 *
 * It looks at:
 *
 *     input
 *     textarea
 *     select
 *
 * For each element, it:
 *
 *     1. Calls detectPIIElement() to check if it contains PII.
 *     2. If PII is found, gets the element's position.
 *     3. Converts that position into screenshot pixels.
 *     4. Stores the PII type, confidence and bounding box.
 *
 * The actual value inside the form field is never read
 * or stored.
 */
function scanFormElements(
    screenshotWidth,
    screenshotHeight
) {

    const elements = document.querySelectorAll(
        "input, textarea, select"
    );

    const detected = [];

    for (const element of elements) {

        const result = detectPIIElement(element);

        if (!result) {
            continue;
        }


        const rect = getElementScreenshotRect(
            element,
            screenshotWidth,
            screenshotHeight
        );


        /*
         * Ignore elements that have no visible area.
         */
        if (rect.width <= 0 || rect.height <= 0) {
            continue;
        }


        detected.push({

            type: result.type,

            source: "dom",

            confidence: result.confidence,

            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        });
    }

    return detected;
}


/* 
   6. LUHN CHECKSUM VALIDATION
 */

/**
 * Checks whether a possible card number passes the
 * Luhn checksum algorithm.
 * The Luhn check performs an additional mathematical
 * validation to reduce these false positives.
 * The function:
 *
 *     1. Removes spaces and hyphens.
 *     2. Reads the digits from right to left.
 *     3. Doubles every second digit.
 *     4. Adjusts doubled digits greater than 9.
 *     5. Adds all the digits together.
 *     6. Checks whether the final total is divisible by 10.
 */
function passesLuhnCheck(candidate) {

    const digits = candidate.replace(/[ -]/g, "");

    let sum = 0;
    let shouldDouble = false;

    for (let i = digits.length - 1; i >= 0; i--) {

        let digit = Number(digits[i]);

        if (shouldDouble) {
            digit *= 2;

            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
        shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
}


/* 
   7. REGEX DETECTION
   */

/**
 * Find all regex-based PII matches inside a text node.
 */
function scanTextForPII(text) {

    const detections = [];

    if (!text || typeof text !== "string") {
        return detections;
    }


    /* 
       Email addresses
    */

    for (const match of text.matchAll(EMAIL_REGEX)) {

        detections.push({
            type: "email",
            source: "regex",
            confidence: 0.95,
            matchStart: match.index,
            matchLength: match[0].length
        });
    }


    /* 
       Phone numbers
        */

    for (const match of text.matchAll(PHONE_REGEX)) {

        detections.push({
            type: "phone",
            source: "regex",
            confidence: 0.90,
            matchStart: match.index,
            matchLength: match[0].length
        });
    }


    /* 
       Card numbers
        */

    for (const match of text.matchAll(CARD_REGEX)) {

        const candidate = match[0];

        /*
         * Remove spaces/hyphens and count actual digits.
         */
        const digits = candidate.replace(/[ -]/g, "");

        /*
         * Require 13-19 actual digits, AND a valid Luhn
         * checksum. The digit-count check alone lets through
         * plenty of non-card numbers; Luhn is what actually
         * confirms card-number structure.
         */
        if (
            digits.length < 13 ||
            digits.length > 19 ||
            !passesLuhnCheck(candidate)
        ) {
            continue;
        }

        detections.push({
            type: "card",
            source: "regex",
            confidence: 0.95,
            matchStart: match.index,
            matchLength: match[0].length
        });
    }


    return detections;
}


/* 
   8. EXACT TEXT-MATCH GEOMETRY
    */

/**
 /**
 * Finds the exact screen position of a PII match inside
 * a text node and converts it into screenshot coordinates.
 *
 * scanTextForPII() tells us where the PII starts and
 * how many characters it contains.
 *
 * This function uses a browser Range to select exactly
 * those characters and find their position on the page.
 *
 * It then converts that position from CSS pixels
 * into screenshot pixels.
 * used when the sensitive data is present in bteween a large chunk of text or other data
 */
function getTextMatchScreenshotRect(
    textNode,
    start,
    length,
    screenshotWidth,
    screenshotHeight
) {

    const range = document.createRange();

    range.setStart(
        textNode,
        start
    );

    range.setEnd(
        textNode,
        start + length
    );


    const rect = range.getBoundingClientRect();


    return cssRectToScreenshotRect(
        rect,
        screenshotWidth,
        screenshotHeight
    );
}


/* 
   9. VISIBLE TEXT SCANNER
    */

/**
 * This function:
 *
 *     1. Goes through the text nodes on the webpage.
 *     2. Ignores text that is hidden or inside form controls.
 *     3. Sends each text node to scanTextForPII().
 *     4. Gets the screen position of every detected match.
 *     5. Converts the position into screenshot pixels.
 *     6. Stores the final bounding box for the redactor.
 */
function scanVisibleText(
    screenshotWidth,
    screenshotHeight
) {

    const detected = [];

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
    );

    let node;

    while (node = walker.nextNode()) {

        const parent = node.parentElement;

        if (!parent) {
            continue;
        }


        /*
         * Ignore invisible elements.
         */
        const style = window.getComputedStyle(parent);

        if (
            style.display === "none" ||
            style.visibility === "hidden"
        ) {
            continue;
        }


        /*
         * Ignore form controls.
         */
        if (
            parent.closest("input, textarea, select")
        ) {
            continue;
        }


        const text = node.textContent;

        if (!text || !text.trim()) {
            continue;
        }


        const matches = scanTextForPII(text);


        for (const match of matches) {

            const rect = getTextMatchScreenshotRect(
                node,
                match.matchStart,
                match.matchLength,
                screenshotWidth,
                screenshotHeight
            );


            if (rect.width <= 0 || rect.height <= 0) {
                continue;
            }


            detected.push({

                type: match.type,

                source: "regex",

                confidence: match.confidence,

                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
        }
    }


    return detected;
}


/* 
   10. DEDUPLICATION
    */

/**
 * Remove duplicate bounding boxes.
 *
 * This prevents the same region from being returned
 * multiple times if multiple detection rules identify it.
 */
function deduplicateDetections(detections) {

    const unique = [];
    const seen = new Set();


    for (const detection of detections) {

        const key = [
            detection.type,
            detection.x,
            detection.y,
            detection.width,
            detection.height
        ].join("|");


        if (seen.has(key)) {
            continue;
        }


        seen.add(key);
        unique.push(detection);
    }


    return unique;
}


/* 
   11. MAIN SCANNER
   */

/**
 * Scan the current webpage for PII.
 */
function scanForPII(
    screenshotWidth,
    screenshotHeight
) {

    if (
        !Number.isFinite(screenshotWidth) ||
        !Number.isFinite(screenshotHeight) ||
        screenshotWidth <= 0 ||
        screenshotHeight <= 0
    ) {
        throw new Error(
            "Valid screenshot dimensions are required."
        );
    }


    /*
     * 1. DOM-based detection
     */
    const formDetections = scanFormElements(
        screenshotWidth,
        screenshotHeight
    );


    /*
     * 2. Regex-based detection
     */
    const textDetections = scanVisibleText(
        screenshotWidth,
        screenshotHeight
    );


    /*
     * 3. Combine everything
     */
    const combined = [
        ...formDetections,
        ...textDetections
    ];


    /*
     * 4. Remove duplicate boxes
     */
    return deduplicateDetections(combined);
}


/* 
   12. EXPORTS
    */

export {
    scanForPII,
    scanFormElements,
    scanVisibleText,
    scanTextForPII,
    detectPIIElement,
    getElementScreenshotRect,
    getTextMatchScreenshotRect,
    passesLuhnCheck
};
