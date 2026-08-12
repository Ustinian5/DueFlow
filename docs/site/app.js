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

const browserDemo = document.querySelector("[data-browser-demo]");

if (browserDemo) {
  const locale = browserDemo.dataset.demoLocale === "zh-CN" ? "zh-CN" : "en";
  const form = browserDemo.querySelector("[data-demo-form]");
  const input = browserDemo.querySelector("[data-demo-input]");
  const status = browserDemo.querySelector("[data-demo-status]");
  const result = browserDemo.querySelector("[data-demo-result]");
  const summary = browserDemo.querySelector("[data-demo-summary]");
  const plan = browserDemo.querySelector("[data-demo-plan]");
  const risk = browserDemo.querySelector("[data-demo-risk]");

  const messages = locale === "zh-CN"
    ? {
        invalid: "请输入一个有效的 ISO 日期，例如 2026-09-30。",
        ready: "样例计划已在当前标签页生成。",
        summary: (date) => `识别到截止日期：${date}`,
        milestones: ["确认要求与交付物", "完成结构提纲", "形成可评审初稿", "处理反馈并终检", "提交并保存回执"],
        overdue: "风险：该日期已经过去，请先确认新的截止日期。",
        urgent: (days) => `风险：仅剩 ${days} 天，建议立即确认范围并锁定提交路径。`,
        tight: (days) => `风险：剩余 ${days} 天，计划可执行，但应尽早完成首次评审。`,
        healthy: (days) => `缓冲：剩余 ${days} 天，可按倒排节点推进。`,
      }
    : {
        invalid: "Enter one valid ISO date, for example 2026-09-30.",
        ready: "The sample plan was generated in this tab.",
        summary: (date) => `Detected deadline: ${date}`,
        milestones: ["Confirm requirements and deliverables", "Complete the outline", "Produce a reviewable draft", "Apply feedback and run final checks", "Submit and save the receipt"],
        overdue: "Risk: this date has passed. Confirm a new deadline before planning.",
        urgent: (days) => `Risk: only ${days} days remain. Confirm scope and submission path now.`,
        tight: (days) => `Risk: ${days} days remain. The plan is workable, but the first review should happen early.`,
        healthy: (days) => `Buffer: ${days} days remain. Follow the reverse-plan milestones below.`,
      };

  const formatDate = (date) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);

  const parseIsoDate = (text) => {
    const match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (!match) return null;

    const yearValue = Number(match[1]);
    const monthValue = Number(match[2]);
    const dayValue = Number(match[3]);
    const date = new Date(Date.UTC(yearValue, monthValue - 1, dayValue));
    if (
      date.getUTCFullYear() !== yearValue
      || date.getUTCMonth() !== monthValue - 1
      || date.getUTCDate() !== dayValue
    ) return null;

    return date;
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const deadline = parseIsoDate(input?.value || "");
    if (!deadline || !status || !result || !summary || !plan || !risk) {
      if (status) status.textContent = messages.invalid;
      if (result) result.hidden = true;
      return;
    }

    const offsets = [10, 7, 4, 2, 0];
    plan.replaceChildren();
    messages.milestones.forEach((label, index) => {
      const milestoneDate = new Date(deadline);
      milestoneDate.setUTCDate(deadline.getUTCDate() - offsets[index]);
      const item = document.createElement("li");
      const dateLabel = document.createElement("time");
      dateLabel.dateTime = milestoneDate.toISOString().slice(0, 10);
      dateLabel.textContent = formatDate(milestoneDate);
      const taskLabel = document.createElement("span");
      taskLabel.textContent = label;
      item.append(dateLabel, taskLabel);
      plan.append(item);
    });

    const today = new Date();
    const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const daysRemaining = Math.ceil((deadline.getTime() - utcToday) / 86_400_000);
    summary.textContent = messages.summary(formatDate(deadline));
    risk.textContent = daysRemaining < 0
      ? messages.overdue
      : daysRemaining <= 3
        ? messages.urgent(daysRemaining)
        : daysRemaining <= 7
          ? messages.tight(daysRemaining)
          : messages.healthy(daysRemaining);
    result.hidden = false;
    status.textContent = messages.ready;
  });
}
