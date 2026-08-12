const copyButton = document.querySelector("[data-copy-target]");
const copyStatus = document.querySelector(".copy-status");

if (copyButton && copyStatus) {
  copyButton.addEventListener("click", async () => {
    const target = document.getElementById(copyButton.dataset.copyTarget);
    const command = target?.innerText.replace(/^\$ /gm, "").trim();
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      copyButton.textContent = "Copied";
      copyStatus.textContent = "Commands copied to clipboard";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
        copyStatus.textContent = "";
      }, 2200);
    } catch {
      copyStatus.textContent = "Select the commands to copy";
    }
  });
}

const year = document.querySelector("[data-current-year]");
if (year) year.textContent = String(new Date().getFullYear());
