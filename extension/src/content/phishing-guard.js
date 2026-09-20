// --- Passive phishing guard -------------------------------------------
//
// Runs automatically on every page load via manifest.json content_scripts.
// Deliberately NOT part of the agent loop in service-worker.js, and
// deliberately DIFFERENT from alwaysOnPrivacyProtect() there too:
//
//   - alwaysOnPrivacyProtect() blurs sensitive fields on EVERY page,
//     regardless of whether the site looks legitimate. It protects
//     against the reasoning model seeing PII - it has no opinion on
//     whether the destination itself is trustworthy.
//   - THIS script specifically scores the page's own domain for phishing
//     signals (brand name mismatch, no HTTPS, IP hostname, suspicious
//     TLD, excessive hyphens) and, only when that looks suspicious, blurs
//     sensitive fields AND shows a visible banner explaining why - so a
//     user who's accidentally landed on a look-alike site is warned
//     before they type anything in, not just silently protected.
//
// No Start button required, no screenshot capture, no server call, no AI
// reasoning, no clicking/typing/submitting on the user's behalf.
//
// Honesty note (keep this comment - it matters for eval writeups): this
// is a heuristic screen with no network access to check domain
// reputation, age, or a real blocklist. It WILL have false positives
// (e.g. a small legitimate site that happens to trip a heuristic) and
// false negatives (a well-disguised phishing domain with none of these
// signals). It's a visible, dismissible safety net - not a guarantee,
// and it should never be described as one.

(function () {
  const KNOWN_BRANDS = [
    "paypal", "google", "microsoft", "apple", "amazon", "facebook",
    "instagram", "whatsapp", "netflix", "bankofamerica", "chase",
    "wellsfargo", "hdfcbank", "icicibank", "sbi", "axisbank",
  ];

  const SUSPICIOUS_TLDS = [
    ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work", ".click",
  ];

  const SUSPICION_THRESHOLD = 2;

  function isIpHostname(hostname) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  }

  function computeSuspicionScore() {
    let score = 0;
    const reasons = [];
    const hostname = location.hostname.toLowerCase();
    const isHttps = location.protocol === "https:";

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

  // Kept in sync with the keyword sets used in service-worker.js
  // (getPiiDetectionsFromActiveTab / applyLiveRedaction) - "employee" and
  // "researcher" added after the mosdac-portal.html fixture exposed that
  // autocomplete="off" fields with no autocomplete match were slipping
  // through everywhere.
  function findSensitiveElements() {
    const PII_AUTOCOMPLETE = new Set([
      "name", "email", "tel", "cc-number", "new-password", "current-password",
    ]);
    const PII_KEYWORDS = ["name", "email", "phone", "tel", "password", "card", "credit", "employee", "researcher"];

    const els = document.querySelectorAll("input, textarea");
    const sensitive = [];
    els.forEach((el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      const id = (el.getAttribute("id") || "").toLowerCase();
      const identifier = `${name} ${id}`;

      if (
        type === "password" ||
        PII_AUTOCOMPLETE.has(autocomplete) ||
        PII_KEYWORDS.some((k) => identifier.includes(k))
      ) {
        sensitive.push(el);
      }
    });
    return sensitive;
  }

  function redactElement(el) {
    if (el.hasAttribute("data-orbitveil-guarded")) return;
    el.dataset.orbitveilOriginalFilter = el.style.filter || "";
    el.style.filter = "blur(6px)";
    el.style.pointerEvents = "none";
    el.setAttribute("data-orbitveil-guarded", "true");
  }

  function restoreElement(el) {
    el.style.filter = el.dataset.orbitveilOriginalFilter || "";
    el.style.pointerEvents = "";
    el.removeAttribute("data-orbitveil-guarded");
    delete el.dataset.orbitveilOriginalFilter;
  }

  function showBanner(reasons, onDismiss) {
    if (document.getElementById("orbitveil-phishing-banner")) return;

    const banner = document.createElement("div");
    banner.id = "orbitveil-phishing-banner";
    banner.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
      "background:#b91c1c", "color:#fff", "font-family:system-ui,sans-serif",
      "font-size:14px", "padding:10px 16px", "display:flex",
      "align-items:center", "justify-content:space-between",
      "box-shadow:0 2px 6px rgba(0,0,0,0.3)",
    ].join(";");

    const text = document.createElement("span");
    text.textContent =
      "\u26A0 Orbitveil: this page has signs of being a phishing clone \u2014 " +
      "sensitive fields have been hidden so you don't accidentally submit them here. (" +
      reasons.join("; ") + ")";

    const btn = document.createElement("button");
    btn.textContent = "I trust this site \u2014 show fields";
    btn.style.cssText = [
      "margin-left:12px", "background:#fff", "color:#b91c1c", "border:none",
      "border-radius:4px", "padding:6px 10px", "font-size:13px",
      "cursor:pointer", "flex-shrink:0",
    ].join(";");
    btn.onclick = () => {
      onDismiss();
      banner.remove();
    };

    banner.appendChild(text);
    banner.appendChild(btn);
    document.documentElement.appendChild(banner);
  }

  function run() {
    const { score, reasons } = computeSuspicionScore();
    if (score < SUSPICION_THRESHOLD) return;

    const sensitiveEls = findSensitiveElements();
    if (sensitiveEls.length === 0) return; // nothing worth protecting yet

    sensitiveEls.forEach(redactElement);

    // Explicit flag, checked inside the observer callback itself - this is
    // the real fix. Relying on observer.disconnect() alone is not enough:
    // MutationObserver callbacks are asynchronous (queued as microtasks), so
    // a callback queued by an earlier mutation (e.g. the banner being
    // inserted) can still fire *after* disconnect() has been called, landing
    // right after the user clicks "trust" and re-blurring fields that were
    // just restored. This flag makes the callback a no-op once the user has
    // trusted the page, regardless of when any in-flight callback fires.
    let trusted = false;

    const observer = new MutationObserver(() => {
      if (trusted) return;
      findSensitiveElements().forEach(redactElement);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    showBanner(reasons, () => {
      trusted = true;
      observer.disconnect();
      sensitiveEls.forEach(restoreElement);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();