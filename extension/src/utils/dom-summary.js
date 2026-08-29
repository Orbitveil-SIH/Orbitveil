function getDomSummary() {
  const elements = document.querySelectorAll("input, textarea, select, button, a");
  const summary = [];

  elements.forEach((el, index) => {
    const entry = {
      index,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      name: el.getAttribute("name") || null,
      id: el.getAttribute("id") || null,
      placeholder: el.getAttribute("placeholder") || null,
      label: getAssociatedLabel(el),
    };

    summary.push(entry);
  });

  return summary;
}

function getAssociatedLabel(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  const parentLabel = el.closest("label");
  if (parentLabel) return parentLabel.textContent.trim();

  return null;
}

export { getDomSummary };
