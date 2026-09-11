// executeActionInPage(action) — SELF-CONTAINED, no imports, no outer
// closures. This gets injected into the page via:
//   chrome.scripting.executeScript({ func: executeActionInPage, args: [action] })
// Same injection pattern already used by getDomSummaryFromActiveTab in
// service-worker.js. Because it's serialized and re-executed in an
// isolated world inside the target page, it CANNOT reference anything
// from the outer module scope — everything it needs must be defined
// inside this single function.

export function executeActionInPage(action) {
  try {
    const { type, target, value } = action || {};

    // --- Target resolution (two tiers) ---------------------------------
    // The schema doesn't guarantee `target` is a real, valid CSS selector
    // — treat it as untrusted input from the VLM, not a trusted selector.
    function resolveTarget(target) {
      if (!target) return null;

      // Tier 1: try it as a literal CSS selector.
      try {
        const el = document.querySelector(target);
        if (el) return el;
      } catch (e) {
        // invalid selector string (e.g. "the search box") - fall through
      }

      // Tier 2: fuzzy text match against visible interactive elements.
      const candidates = document.querySelectorAll(
        "input, textarea, select, button, a, [role='button']"
      );
      const needle = String(target).toLowerCase().trim();
      if (!needle) return null;

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      }

      function getLabelText(el) {
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) return label.textContent || "";
        }
        const parentLabel = el.closest("label");
        if (parentLabel) return parentLabel.textContent || "";
        return "";
      }

      function fieldsOf(el) {
        return [
          getLabelText(el),
          el.getAttribute("placeholder") || "",
          el.getAttribute("name") || "",
          el.getAttribute("id") || "",
          el.getAttribute("aria-label") || "",
          el.textContent || "",
          el.value || "",
        ]
          .join(" ")
          .toLowerCase();
      }

      let bestMatch = null;
      let bestScore = 0;

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const haystack = fieldsOf(el);
        if (!haystack.trim()) continue;

        let score = 0;
        if (haystack.includes(needle)) {
          score = needle.length; // longer exact substring match = stronger
        } else {
          // loose word-overlap fallback
          const needleWords = needle.split(/\s+/).filter(Boolean);
          const matchedWords = needleWords.filter((w) => haystack.includes(w));
          score = matchedWords.length / Math.max(needleWords.length, 1);
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = el;
        }
      }

      return bestMatch;
    }

    // --- Action handlers -------------------------------------------------

    function doClick(el) {
      if (!el) return { success: false, error: "No matching element found for click." };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      if (typeof el.focus === "function") el.focus();
      el.click();
      return { success: true };
    }

    function doType(el, text) {
      if (!el) return { success: false, error: "No matching element found for type." };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      if (typeof el.focus === "function") el.focus();

      const tag = el.tagName.toLowerCase();

      if (tag === "select") {
        el.value = text;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }

      // Native value setter trick: plain `el.value = text` is invisible to
      // React/Vue-style controlled inputs, because they patch the value
      // property's setter and only react to the native setter + a real
      // dispatched event, not a direct property assignment.
      const proto =
        tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    }

    function doScroll(directionValue) {
      const amount = Math.round(window.innerHeight * 0.8);
      const dir = (directionValue || "down").toLowerCase();
      const delta = dir === "up" ? -amount : amount;
      window.scrollBy({ top: delta, behavior: "instant" });
      return { success: true };
    }

    // --- Dispatch ----------------------------------------------------

    switch (type) {
      case "click": {
        const el = resolveTarget(target);
        return doClick(el);
      }
      case "type": {
        const el = resolveTarget(target);
        return doType(el, value ?? "");
      }
      case "scroll": {
        // Schema has no direction field yet - reuse `value` as an
        // optional direction string ("up" / "down"), default down.
        return doScroll(value);
      }
      case "wait":
      case "done":
        return { success: true };
      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    // Never throw - one bad action shouldn't kill the whole loop.
    return { success: false, error: err.message || String(err) };
  }
}
