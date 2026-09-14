"use strict";

const captureBtn = document.getElementById("btn-capture");
const compareBtn = document.getElementById("btn-compare");
const exportBtn = document.getElementById("btn-export");
const deleteBtn = document.getElementById("btn-delete");
const messageEl = document.getElementById("message");
const resultsEl = document.getElementById("results");
const diffOutputEl = document.getElementById("diff-output");
const changeSummaryEl = document.getElementById("change-summary");
const baselineInfoEl = document.getElementById("baseline-info");
const baselineStatusEl = document.getElementById("baseline-status");
const replaceConfirmEl = document.getElementById("replace-confirm");
const screenshotsEl = document.getElementById("screenshots");
const screenshotBaselineEl = document.getElementById("screenshot-baseline");
const screenshotCurrentEl = document.getElementById("screenshot-current");

let hasBaseline = false;
let pendingCapture = false;

function showMessage(text, type = "info") {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.classList.remove("hidden");
}

function hideMessage() {
  messageEl.classList.add("hidden");
}

function updateButtons() {
  compareBtn.disabled = !hasBaseline;
  exportBtn.disabled = !hasBaseline;
  deleteBtn.disabled = !hasBaseline;
}

function updateBaselineStatus(has) {
  hasBaseline = has;
  baselineStatusEl.textContent = has ? "baseline saved" : "no baseline";
  baselineStatusEl.className = `status-badge ${has ? "saved" : "none"}`;
  baselineStatusEl.classList.remove("hidden");
  updateButtons();
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function checkBaseline() {
  try {
    const res = await send({ type: "GET_BASELINE" });
    if (res.ok) {
      updateBaselineStatus(!!res.baseline);
      if (res.baseline) {
        const date = new Date(res.baseline.timestamp);
        baselineInfoEl.querySelector("p").textContent =
          `Baseline saved: ${date.toLocaleString()}`;
        baselineInfoEl.classList.remove("hidden");
      } else {
        baselineInfoEl.classList.add("hidden");
      }
    }
  } catch {
    updateBaselineStatus(false);
  }
}

function setText(el, text) {
  el.textContent = text;
}

function renderDiff(report) {
  diffOutputEl.textContent = "";
  screenshotsEl.classList.add("hidden");

  if (report.changeCount === 0) {
    changeSummaryEl.textContent = "No observed changes.";
    changeSummaryEl.className = "clean";
    return;
  }

  changeSummaryEl.textContent = `${report.changeCount} change${report.changeCount === 1 ? "" : "s"} detected.`;
  changeSummaryEl.className = "changes";

  if (!report.urlMatch) {
    const warn = document.createElement("div");
    warn.className = "diff-item";
    warn.style.borderColor = "#f59e0b";
    warn.style.background = "#fffbeb";
    setText(warn, "Warning: URLs do not match exactly. The baseline was saved for a different URL.");
    diffOutputEl.appendChild(warn);
  }

  const sections = [];

  if (report.changes.title) {
    sections.push({
      heading: "Title",
      items: [{ before: report.changes.title.before, after: report.changes.title.after }]
    });
  }

  const metaDescChanges = report.changes.metaDescriptions || [];
  if (metaDescChanges.length > 0) {
    sections.push({ heading: "Meta Descriptions", items: metaDescChanges });
  }

  const canonicalChanges = report.changes.canonicals || [];
  if (canonicalChanges.length > 0) {
    sections.push({ heading: "Canonical Links", items: canonicalChanges });
  }

  const robotChanges = report.changes.robots || [];
  if (robotChanges.length > 0) {
    sections.push({ heading: "Robots / Googlebot", items: robotChanges });
  }

  const headingChanges = report.changes.headings || [];
  if (headingChanges.length > 0) {
    sections.push({ heading: "Headings (H1-H3)", items: headingChanges });
  }

  const internalRemoved = report.changes.internalLinksRemoved || [];
  if (internalRemoved.length > 0) {
    sections.push({
      heading: "Removed Internal Links",
      items: internalRemoved.map(u => ({ before: u, after: null, type: "removed" }))
    });
  }

  const extAdded = report.changes.externalLinksAdded || [];
  const extRemoved = report.changes.externalLinksRemoved || [];
  if (extAdded.length > 0 || extRemoved.length > 0) {
    const allExt = [
      ...extAdded.map(u => ({ before: null, after: u, type: "added" })),
      ...extRemoved.map(u => ({ before: u, after: null, type: "removed" }))
    ];
    sections.push({ heading: "External Links", items: allExt });
  }

  const suspicious = report.changes.suspiciousLinks || [];
  if (suspicious.length > 0) {
    sections.push({
      heading: "Suspicious Links (review)",
      items: suspicious.map(u => ({ before: null, after: u, type: "review" }))
    });
  }

  for (const section of sections) {
    const secEl = document.createElement("div");
    secEl.className = "diff-section";
    const h3 = document.createElement("h3");
    setText(h3, section.heading);
    secEl.appendChild(h3);

    for (const item of section.items) {
      const div = document.createElement("div");
      div.className = "diff-item";
      if (item.type === "review") {
        div.style.borderColor = "#f59e0b";
        div.style.background = "#fffbeb";
      }
      if (item.before !== undefined && item.before !== null) {
        const b = document.createElement("span");
        b.className = "before";
        setText(b, typeof item.before === "string" ? item.before : JSON.stringify(item.before));
        div.appendChild(b);
      }
      if (item.after !== undefined && item.after !== null) {
        const a = document.createElement("span");
        a.className = "after";
        setText(a, typeof item.after === "string" ? item.after : JSON.stringify(item.after));
        div.appendChild(a);
      }
      if (item.before === null && item.after === null) {
        const n = document.createElement("span");
        n.className = "neutral";
        setText(n, "(no value)");
        div.appendChild(n);
      }
      secEl.appendChild(div);
    }
    diffOutputEl.appendChild(secEl);
  }

  if (report.baselineScreenshot || report.currentScreenshot) {
    screenshotsEl.classList.remove("hidden");
    if (report.baselineScreenshot) {
      screenshotBaselineEl.src = report.baselineScreenshot;
    } else {
      screenshotBaselineEl.alt = "Baseline screenshot not available";
      screenshotBaselineEl.removeAttribute("src");
    }
    if (report.currentScreenshot) {
      screenshotCurrentEl.src = report.currentScreenshot;
    } else {
      screenshotCurrentEl.alt = "Current screenshot not available";
      screenshotCurrentEl.removeAttribute("src");
    }
  }
}

captureBtn.addEventListener("click", async () => {
  hideMessage();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showMessage("No active tab found.", "error"); return; }

  // Check if baseline already exists for this URL
  const existing = await send({ type: "GET_BASELINE" });
  if (existing.ok && existing.baseline) {
    replaceConfirmEl.classList.remove("hidden");
    pendingCapture = true;
    return;
  }

  await doCapture();
});

document.getElementById("btn-replace-yes").addEventListener("click", async () => {
  replaceConfirmEl.classList.add("hidden");
  await doCapture();
});

document.getElementById("btn-replace-no").addEventListener("click", () => {
  replaceConfirmEl.classList.add("hidden");
  pendingCapture = false;
});

async function doCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showMessage("No active tab found.", "error"); return; }
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing...";
  try {
    const res = await send({ type: "CAPTURE_BASELINE", tabId: tab.id });
    if (res.ok) {
      showMessage("Baseline captured.", "success");
      updateBaselineStatus(true);
      if (!baselineInfoEl.querySelector("p").textContent.includes("Baseline saved")) {
        baselineInfoEl.querySelector("p").textContent = "Baseline saved: " + new Date().toLocaleString();
      }
      baselineInfoEl.classList.remove("hidden");
    } else {
      showMessage(res.error || "Capture failed.", "error");
    }
  } catch (err) {
    showMessage(err.message || "Capture failed.", "error");
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = "Capture Baseline";
  }
}

compareBtn.addEventListener("click", async () => {
  hideMessage();
  resultsEl.classList.add("hidden");
  compareBtn.disabled = true;
  compareBtn.textContent = "Comparing...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showMessage("No active tab found.", "error"); return; }
    const res = await send({ type: "COMPARE_BASELINE", tabId: tab.id });
    if (res.ok) {
      resultsEl.classList.remove("hidden");
      renderDiff(res.report);
    } else {
      showMessage(res.error || "Comparison failed.", "error");
    }
  } catch (err) {
    showMessage(err.message || "Comparison failed.", "error");
  } finally {
    compareBtn.disabled = false;
    compareBtn.textContent = "Compare With Baseline";
  }
});

exportBtn.addEventListener("click", async () => {
  hideMessage();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showMessage("No active tab found.", "error"); return; }
    const res = await send({ type: "EXPORT_REPORT", tabId: tab.id });
    if (!res.ok) { showMessage(res.error || "Export failed.", "error"); return; }
    const blob = new Blob([res.reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seo-baseline-report.html";
    a.click();
    URL.revokeObjectURL(url);
    showMessage("Report downloaded.", "success");
  } catch (err) {
    showMessage(err.message || "Export failed.", "error");
  }
});

deleteBtn.addEventListener("click", async () => {
  hideMessage();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showMessage("No active tab found.", "error"); return; }
    const res = await send({ type: "DELETE_BASELINE", tabId: tab.id });
    if (res.ok) {
      showMessage("Baseline deleted.", "success");
      resultsEl.classList.add("hidden");
      await checkBaseline();
    } else {
      showMessage(res.error || "Delete failed.", "error");
    }
  } catch (err) {
    showMessage(err.message || "Delete failed.", "error");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  checkBaseline();
});
