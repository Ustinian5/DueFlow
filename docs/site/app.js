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
  const shareButton = browserDemo.querySelector("[data-demo-share]");
  const shareStatus = browserDemo.querySelector("[data-demo-share-status]");
  const installButton = browserDemo.querySelector("[data-demo-install]");
  const copyPlanButton = browserDemo.querySelector("[data-demo-copy-plan]");
  const calendarButton = browserDemo.querySelector("[data-demo-download-calendar]");
  const exportStatus = browserDemo.querySelector("[data-demo-export-status]");
  let installPrompt = null;
  let generatedDeadline = null;
  let generatedMilestones = [];
  let generatedRisk = "";

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
        shareTitle: "DueFlow — 本地优先的截止日期规划助手",
        shareText: "我用 DueFlow 的本地浏览器样例，把一个截止日期变成了五步倒排计划。",
        shared: "分享面板已打开。",
        copied: "DueFlow 介绍和链接已复制。",
        shareFallback: "可复制此链接分享：https://ustinian5.github.io/DueFlow/zh/",
        installed: "离线样例已安装。",
        installDismissed: "本次未安装，之后仍可再次选择安装。",
        planTitle: "DueFlow 倒排计划",
        planCopied: "倒排计划已复制。",
        calendarDownloaded: "日历文件已下载。",
        exportUnavailable: "请先生成一个有效的样例计划。",
        exportFailed: "导出未完成，请重试。",
        calendarDescription: "由 DueFlow 浏览器样例在本地生成。",
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
        shareTitle: "DueFlow — local-first deadline planning",
        shareText: "I turned one deadline into a five-step reverse plan with DueFlow's local browser sample.",
        shared: "The share panel is open.",
        copied: "DueFlow's introduction and link were copied.",
        shareFallback: "Copy this link to share: https://ustinian5.github.io/DueFlow/",
        installed: "The offline sample is installed.",
        installDismissed: "Installation was dismissed. You can install it later.",
        planTitle: "DueFlow reverse plan",
        planCopied: "The reverse plan was copied.",
        calendarDownloaded: "The calendar file was downloaded.",
        exportUnavailable: "Generate a valid sample plan first.",
        exportFailed: "The export did not complete. Try again.",
        calendarDescription: "Generated locally by the DueFlow browser sample.",
      };

  const shareUrl = locale === "zh-CN"
    ? "https://ustinian5.github.io/DueFlow/zh/"
    : "https://ustinian5.github.io/DueFlow/";

  const formatDate = (date) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);

  const isoDate = (date) => date.toISOString().slice(0, 10);
  const icsDate = (date) => isoDate(date).replace(/-/g, "");
  const escapeIcs = (value) => String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

  const buildPlanText = () => [
    `${messages.planTitle} — ${isoDate(generatedDeadline)}`,
    ...generatedMilestones.map(({ date, label }) => `- ${isoDate(date)} — ${label}`),
    generatedRisk,
    shareUrl,
  ].join("\n");

  const buildCalendar = () => {
    const stamp = `${icsDate(generatedDeadline)}T000000Z`;
    const events = generatedMilestones.flatMap(({ date, label }, index) => {
      const endDate = new Date(date);
      endDate.setUTCDate(date.getUTCDate() + 1);
      return [
        "BEGIN:VEVENT",
        `UID:dueflow-demo-${icsDate(date)}-${index}@ustinian5.github.io`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(date)}`,
        `DTEND;VALUE=DATE:${icsDate(endDate)}`,
        `SUMMARY:${escapeIcs(label)}`,
        `DESCRIPTION:${escapeIcs(`${messages.calendarDescription} ${messages.summary(formatDate(generatedDeadline))}`)}`,
        "END:VEVENT",
      ];
    });
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//DueFlow//Browser Demo//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  };

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
      generatedDeadline = null;
      generatedMilestones = [];
      generatedRisk = "";
      if (status) status.textContent = messages.invalid;
      if (result) result.hidden = true;
      return;
    }

    const offsets = [10, 7, 4, 2, 0];
    generatedDeadline = deadline;
    generatedMilestones = messages.milestones.map((label, index) => {
      const date = new Date(deadline);
      date.setUTCDate(deadline.getUTCDate() - offsets[index]);
      return { date, label };
    });
    plan.replaceChildren();
    generatedMilestones.forEach(({ date: milestoneDate, label }) => {
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
    generatedRisk = risk.textContent;
    result.hidden = false;
    status.textContent = messages.ready;
  });

  copyPlanButton?.addEventListener("click", async () => {
    if (!generatedDeadline || generatedMilestones.length === 0 || !exportStatus) {
      if (exportStatus) exportStatus.textContent = messages.exportUnavailable;
      return;
    }

    try {
      await navigator.clipboard.writeText(buildPlanText());
      exportStatus.textContent = messages.planCopied;
    } catch {
      exportStatus.textContent = messages.exportFailed;
    }
  });

  calendarButton?.addEventListener("click", () => {
    if (!generatedDeadline || generatedMilestones.length === 0 || !exportStatus) {
      if (exportStatus) exportStatus.textContent = messages.exportUnavailable;
      return;
    }

    try {
      const blob = new Blob([buildCalendar()], { type: "text/calendar;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = objectUrl;
      download.download = `dueflow-reverse-plan-${isoDate(generatedDeadline)}.ics`;
      document.body.append(download);
      download.click();
      download.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      exportStatus.textContent = messages.calendarDownloaded;
    } catch {
      exportStatus.textContent = messages.exportFailed;
    }
  });

  shareButton?.addEventListener("click", async () => {
    if (!shareStatus) return;

    const shareData = {
      title: messages.shareTitle,
      text: messages.shareText,
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        shareStatus.textContent = messages.shared;
        return;
      }

      await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      shareStatus.textContent = messages.copied;
    } catch (error) {
      if (error?.name !== "AbortError") shareStatus.textContent = messages.shareFallback;
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt || !shareStatus) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    shareStatus.textContent = choice.outcome === "accepted"
      ? messages.installed
      : messages.installDismissed;
    installPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
    if (shareStatus) shareStatus.textContent = messages.installed;
  });
}

if ("serviceWorker" in navigator) {
  const siteRoot = document.documentElement.lang === "zh-CN" ? "../" : "./";
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${siteRoot}service-worker.js`, { scope: siteRoot }).catch(() => {});
  });
}
