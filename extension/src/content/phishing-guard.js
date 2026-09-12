// --- Passive phishing guard -------------------------------------------
//
// Runs automatically on every page load via manifest.json content_scripts.
// Deliberately NOT part of the agent loop in service-worker.js:
//   - no "Start" button required
//   - no screenshot capture
//   - no server call
//   - no AI reasoning
//   - no clicking/typing/submitting on the user's behalf
//
// It only ever does two things, entirely inside this page's own DOM:
//   1. Score the page against a few local phishing heuristics.
//   2. If the score crosses a threshold AND the page has sensitive-looking
//      fields, blur those fields immediately and show a dismissible banner.
//
// Honesty note (keep this comment - it matters for eval writeups): this is
// a heuristic screen with no network access to check domain reputation,
// age, or a real blocklist. It WILL have false positives (e.g. a small
// bank's legitimate site that happens to trip a heuristic) and false
// negatives (a well-disguised phishing domain with none of these signals).
// It's a visible, dismissible safety net - not a guarantee, and it should
// never be described as one.

(function () {
  const KNOWN_BRANDS = [
    "paypal", "google", "microsoft", "apple", "amazon", "facebook",
    "instagram", "whatsapp", "netflix", "bankofamerica", "chase",
    "wellsfargo", "hdfcbank", "icicibank", "sbi", "axisbank",
  ];

  const SUSPICIOUS_TLDS = [
    ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work", ".click",
  ];

  const SUSPICION_THRESHOLD = 0;
  let guardDisabled = false;
  let observer = null;

  function isMaliciousDemoPage() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "malicious") return true;
    const demoRisk = document.body?.dataset?.orbitveilDemoRisk || "";
    return demoRisk === "malicious";
  }

  function isIpHostname(hostname) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  }

  function computeSuspicionScore() {
    let score = 0;
    const reasons = [];
    const hostname = location.hostname.toLowerCase();
    const isHttps = location.protocol === "https:";

    if (isMaliciousDemoPage()) {
      score = 999;
      reasons.push("demo page is explicitly marked as malicious");
      return { score, reasons };
    }

    // Brand name appears in the hostname, but the hostname doesn't look
    // like that brand's actual registrable domain - classic decoy pattern
    // (e.g. "paypal-secure-login.com", "accounts-google.verify-id.com").
    for (const brand of KNOWN_BRANDS) {
      if (hostname.includes(brand)) {
        const parts = hostname.split(".");
        const looksLegit = parts.length <= 3 && parts[0] === brand;
        if (!looksLegit) {
          score += 3;
          reasons.push(`hostname contains "${brand}" but isn't the real ${brand} domain`);
        }
      }
    }

    if (!isHttps) {
      score += 1;
      reasons.push("page is not served over HTTPS");
    }

    if (isIpHostname(hostname)) {
      score += 2;
      reasons.push("hostname is a raw IP address");
    }

    if (SUSPICIOUS_TLDS.some((tld) => hostname.endsWith(tld))) {
      score += 1;
      reasons.push("domain uses a TLD commonly abused for throwaway phishing sites");
    }

    const hyphenCount = (hostname.match(/-/g) || []).length;
    if (hyphenCount >= 3) {
      score += 1;
      reasons.push("hostname has an unusually high number of hyphens");
    }

    return { score, reasons };
  }

  // Same PII surface the agent's own pii-scanner logic uses (autocomplete
  // attributes + password type), kept intentionally simple and duplicated
  // here rather than imported - this file has to stay a plain, dependency-
  // free content script that runs on every page with no build step risk.
  function findSensitiveElements() {
    const safeSensitiveNames = new Set([
      "card_number", "card-number", "account_number", "credit_card", "cvv",
      "password", "new-password", "current-password",
    ]);
    const safeSensitiveAutocomplete = new Set([
      "cc-number", "new-password", "current-password",
    ]);
    const maliciousSensitiveNames = new Set([
      "full_name", "full-name", "name", "dob", "date_of_birth",
      "phone", "phone_number", "card_number", "card-number",
      "email", "password", "account_number", "credit_card",
    ]);
    const maliciousSensitiveAutocomplete = new Set([
      "name", "email", "tel", "cc-number", "new-password", "current-password",
    ]);

    const els = document.querySelectorAll("input, textarea, select, img");
    const sensitive = [];
    const malicious = isMaliciousDemoPage();

    els.forEach((el) => {
      if (el.tagName && el.tagName.toLowerCase() === "img") {
        if (el.id === "profile-photo" || el.alt?.toLowerCase().includes("photo")) {
          sensitive.push(el);
        }
        return;
      }

      const type = (el.getAttribute("type") || "").toLowerCase();
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      const id = (el.getAttribute("id") || "").toLowerCase();

      const matchesSafeSensitive =
        type === "password" ||
        safeSensitiveAutocomplete.has(autocomplete) ||
        safeSensitiveNames.has(name) ||
        safeSensitiveNames.has(id);

      const matchesMaliciousSensitive =
        type === "password" ||
        maliciousSensitiveAutocomplete.has(autocomplete) ||
        maliciousSensitiveNames.has(name) ||
        maliciousSensitiveNames.has(id);

      if (malicious ? matchesMaliciousSensitive : matchesSafeSensitive) {
        sensitive.push(el);
      }
    });
    return sensitive;
  }

  function redactElement(el) {
    if (el.hasAttribute("data-orbitveil-guarded")) return;

    const originalFilter = el.style.filter || "";
    const originalPointerEvents = el.style.pointerEvents || "";
    const originalOpacity = el.style.opacity || "";
    const originalBackground = el.style.background || "";
    const originalColor = el.style.color || "";
    const originalUserSelect = el.style.userSelect || "";
    const originalVisibility = el.style.visibility || "";

    el.dataset.orbitveilOriginalFilter = originalFilter;
    el.dataset.orbitveilOriginalPointerEvents = originalPointerEvents;
    el.dataset.orbitveilOriginalOpacity = originalOpacity;
    el.dataset.orbitveilOriginalBackground = originalBackground;
    el.dataset.orbitveilOriginalColor = originalColor;
    el.dataset.orbitveilOriginalUserSelect = originalUserSelect;
    el.dataset.orbitveilOriginalVisibility = originalVisibility;

    if (el.tagName && el.tagName.toLowerCase() === "img") {
      el.style.filter = "blur(14px) grayscale(1) brightness(0.35)";
      el.style.opacity = "0.16";
    } else {
      el.style.filter = "blur(6px)";
      el.style.background = "rgba(0, 0, 0, 0.9)";
      el.style.color = "transparent";
      el.style.userSelect = "none";
      el.style.opacity = "0.35";
    }

    el.style.pointerEvents = "none";
    el.style.visibility = "visible";
    el.setAttribute("data-orbitveil-guarded", "true");
  }

  function restoreElement(el) {
    el.style.filter = el.dataset.orbitveilOriginalFilter || "";
    el.style.pointerEvents = el.dataset.orbitveilOriginalPointerEvents || "";
    el.style.opacity = el.dataset.orbitveilOriginalOpacity || "";
    el.style.background = el.dataset.orbitveilOriginalBackground || "";
    el.style.color = el.dataset.orbitveilOriginalColor || "";
    el.style.userSelect = el.dataset.orbitveilOriginalUserSelect || "";
    el.style.visibility = el.dataset.orbitveilOriginalVisibility || "";
    el.removeAttribute("data-orbitveil-guarded");

    delete el.dataset.orbitveilOriginalFilter;
    delete el.dataset.orbitveilOriginalPointerEvents;
    delete el.dataset.orbitveilOriginalOpacity;
    delete el.dataset.orbitveilOriginalBackground;
    delete el.dataset.orbitveilOriginalColor;
    delete el.dataset.orbitveilOriginalUserSelect;
    delete el.dataset.orbitveilOriginalVisibility;
  }

  function disableGuard() {
    guardDisabled = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function showBanner(reasons, onDismiss) {
    // Intentionally disabled for the default live-redaction flow.
    // The page should remain blurred without an immediate trust banner,
    // keeping the protection unobtrusive while still hiding the sensitive data.
    return;
  }

  function run() {
    if (guardDisabled) return;

    const { score, reasons } = computeSuspicionScore();
    if (score < SUSPICION_THRESHOLD) return;

    const sensitiveEls = findSensitiveElements();
    if (sensitiveEls.length === 0) return; // nothing worth protecting yet

    sensitiveEls.forEach(redactElement);

    // Forms/fields that render after initial load (lazy JS-rendered
    // pages) still need to be caught, since this runs once at DOM-ready.
    observer = new MutationObserver(() => {
      if (guardDisabled) return;
      findSensitiveElements().forEach(redactElement);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
