"use strict";
const el = id => document.getElementById(id);
let target = null, baseline = null, busy = false;
function message(text, type = "info") {
  el("message").textContent = text;
  el("message").className = `message ${type}`;
}
function buttons() {
  el("btn-capture").disabled = busy || !target;
  for (const id of ["btn-compare", "btn-export", "btn-delete"]) el(id).disabled = busy || !target || !baseline;
  for (const id of ["btn-replace-yes", "btn-replace-no"]) el(id).disabled = busy;
}
async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...target, ...extra });
  if (!response?.ok) throw new Error(response?.error || "The extension did not respond. Reopen it and retry.");
  return response;
}
function baselineStatus() {
  el("baseline-status").textContent = baseline ? "baseline saved" : "no baseline";
  el("baseline-status").className = `status-badge ${baseline ? "saved" : "none"}`;
  el("baseline-info").classList.toggle("hidden", !baseline);
  el("baseline-info").querySelector("p").textContent = baseline
    ? `Baseline: ${new Date(baseline.timestamp).toLocaleString()}\n${baseline.url}` : "";
  buttons();
}
function append(parent, tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
function render(report) {
  el("results").classList.remove("hidden");
  el("diff-output").replaceChildren();
  el("change-summary").textContent = report.changeCount ? `${report.changeCount} observed changes` : "No observed SEO changes.";
  el("change-summary").className = report.changeCount ? "changes" : "clean";
  const output = el("diff-output");
  append(output, "p", `${report.url}\nBaseline: ${new Date(report.baselineTimestamp).toLocaleString()}\nCurrent: ${new Date(report.currentTimestamp).toLocaleString()}`, "report-meta");
  for (const warning of report.warnings || []) append(output, "p", warning, "warning");
  const labels = { title: "Title", metaDescriptions: "Meta descriptions", canonicals: "Canonical links",
    robots: "Robots / Googlebot", headings: "Headings", internalLinksRemoved: "Removed internal links",
    externalLinksAdded: "Added external links", externalLinksRemoved: "Removed external links" };
  for (const [key, label] of Object.entries(labels)) {
    const values = report.changes[key];
    const items = values ? Array.isArray(values) ? values : [values] : [];
    if (!items.length) continue;
    const section = append(output, "section", "", "diff-section");
    append(section, "h3", label);
    for (let item of items) {
      if (typeof item === "string") item = key.endsWith("Added") ? { before: null, after: item } : { before: item, after: null };
      const row = append(section, "div", "", "diff-item");
      for (const side of ["before", "after"]) {
        const block = append(row, "div", "", side);
        append(block, "span", side === "before" ? "Before" : "After", "label");
        append(block, "span", item[side] === null || item[side] === undefined ? "(absent)" : String(item[side]), "value");
      }
    }
  }
  if (report.changes.suspiciousLinks?.length) {
    const section = append(output, "section", "", "warning");
    append(section, "h3", "Private-address links to review");
    append(section, "p", "Warnings, not additional changes.");
    for (const url of report.changes.suspiciousLinks) append(section, "p", url);
  }
  el("screenshots").classList.remove("hidden");
  for (const [id, source] of [["screenshot-baseline", report.baselineScreenshot], ["screenshot-current", report.currentScreenshot]]) {
    const image = el(id), missing = el(`${id}-missing`);
    const valid = typeof source === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(source);
    image.classList.toggle("hidden", !valid);
    missing.classList.toggle("hidden", valid);
    if (valid) image.src = source;
    else image.removeAttribute("src");
  }
}
async function action(fn) {
  if (busy) return;
  busy = true;
  buttons();
  el("message").classList.add("hidden");
  try { await fn(); }
  catch (error) { message(error.message || "Action failed.", "error"); }
  finally { busy = false; buttons(); }
}
async function capture(confirmed = false) {
  const response = await send("CAPTURE_BASELINE", { replaceConfirmed: confirmed });
  baseline = response.snapshot;
  el("results").classList.add("hidden");
  el("replace-confirm").classList.add("hidden");
  baselineStatus();
  message(response.warnings?.length ? `Baseline captured with a warning. ${response.warnings.join(" ")}` : "Baseline captured.", response.warnings?.length ? "info" : "success");
}
el("btn-capture").addEventListener("click", () => action(async () => {
  const result = await send("GET_BASELINE");
  baseline = result.baseline;
  baselineStatus();
  if (baseline) el("replace-confirm").classList.remove("hidden");
  else await capture();
}));
el("btn-replace-yes").addEventListener("click", () => action(() => capture(true)));
el("btn-replace-no").addEventListener("click", () => el("replace-confirm").classList.add("hidden"));
el("btn-compare").addEventListener("click", () => action(async () => {
  el("replace-confirm").classList.add("hidden");
  el("results").classList.add("hidden");
  const result = await send("COMPARE_BASELINE");
  render(result.report);
}));
el("btn-delete").addEventListener("click", () => action(async () => {
  await send("DELETE_BASELINE");
  baseline = null;
  baselineStatus();
  el("results").classList.add("hidden");
  el("replace-confirm").classList.add("hidden");
  message("Baseline and saved comparison deleted.", "success");
}));
el("btn-export").addEventListener("click", () => action(async () => {
  const response = await send("EXPORT_REPORT");
  const url = URL.createObjectURL(new Blob([response.reportHtml], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "seo-change-guard-report.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  message("Report download requested. Review it before sharing.", "success");
}));
document.addEventListener("DOMContentLoaded", () => action(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No accessible active page. Open an HTTP/HTTPS page and click the extension icon.");
  target = { tabId: tab.id, expectedUrl: tab.url };
  const result = await send("GET_BASELINE");
  baseline = result.baseline;
  baselineStatus();
  if (result.lastReport) render(result.lastReport);
}));
