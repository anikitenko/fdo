"use strict";

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const status = document.getElementById("copy-status");
    try {
      await navigator.clipboard.writeText(
        document.getElementById(button.dataset.copy).textContent,
      );
      button.textContent = "Copied ✓";
      status.textContent = "Commands copied to clipboard.";
      setTimeout(() => {
        button.textContent = "Copy commands ⧉";
      }, 2200);
    } catch {
      status.textContent =
        "Clipboard unavailable. Select and copy the commands in the terminal example.";
    }
  });
}

// All screenshots remain visible when JavaScript is unavailable.
const tourButtons = [...document.querySelectorAll("[data-tour]")];
const tourPanels = [...document.querySelectorAll("[data-tour-panel]")];
if (tourButtons.length && tourPanels.length) {
  const selectTour = (id, announce = false) => {
    for (const button of tourButtons)
      button.setAttribute("aria-pressed", String(button.dataset.tour === id));
    for (const panel of tourPanels) {
      const selected = panel.dataset.tourPanel === id;
      panel.hidden = !selected;
      if (selected) {
        // Hidden panels can defer lazy images indefinitely in some browsers.
        // Start loading as soon as a view is selected, before it is scrolled into view.
        const image = panel.querySelector("img");
        image.loading = "eager";
      }
    }
    if (announce)
      document.getElementById("tour-status").textContent =
        tourButtons
          .find((button) => button.dataset.tour === id)
          .textContent.trim() + " screenshot selected.";
  };
  for (const button of tourButtons)
    button.addEventListener("click", () =>
      selectTour(button.dataset.tour, true),
    );
  selectTour(tourButtons[0].dataset.tour);
  document.querySelector(".tour-controls").hidden = false;
}
