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
