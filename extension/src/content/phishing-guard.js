// Active protection is handled by the extension's model-driven detection flow.
// This passive content script should not blur the page on load, because that
// happens before the user explicitly triggers the extension and violates the
// expected start-of-session behavior.
(function () {
  // Intentionally empty: no automatic DOM redaction at page load.
})();
