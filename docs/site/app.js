const copyButton = document.querySelector("[data-copy-target]");
const copyStatus = document.querySelector(".copy-status");

if (copyButton && copyStatus) {
  copyButton.addEventListener("click", async () => {
    const target = document.getElementById(copyButton.dataset.copyTarget);
    const command = target?.innerText.replace(/^\$ /gm, "").trim();
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      copyButton.textContent = copyButton.dataset.copySuccess || "Copied";
      copyStatus.textContent = copyButton.dataset.copyMessage || "Commands copied to clipboard";
      window.setTimeout(() => {
        copyButton.textContent = copyButton.dataset.copyReset || "Copy";
        copyStatus.textContent = "";
      }, 2200);
    } catch {
      copyStatus.textContent = copyButton.dataset.copyFallback || "Select the commands to copy";
    }
  });
}

const year = document.querySelector("[data-current-year]");
if (year) year.textContent = String(new Date().getFullYear());
