// Reduced from the failed personal-space renderer: comma missing before data-section.
export function renderPersonal(dom: {createElement: (options: object) => string}): string {
  return dom.createElement({
    tag: "div",
    class: "space-section"
    "data-section": "saved",
  });
}
