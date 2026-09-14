importScripts("../lib/extract.js", "../lib/diff.js", "../lib/report.js");
let queue = Promise.resolve();
let lastScreenshotAt = 0;
const normalizeUrl = value => {
  const url = new URL(value);
  url.hash = "";
  return url.href;
};
const storageKey = url => `page:${normalizeUrl(url)}`;

async function targetTab(message) {
  if (!Number.isInteger(message.tabId) || !message.expectedUrl) throw new Error("Page context is missing. Close and reopen the extension.");
  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.active || normalizeUrl(tab.url || "") !== normalizeUrl(message.expectedUrl)) {
    throw new Error("The active page changed. Close and reopen the extension.");
  }
  if (!/^https?:\/\//i.test(tab.url)) throw new Error("Only HTTP/HTTPS pages are supported. Browser settings and local files cannot be captured.");
  return tab;
}
async function readRecord(url) {
  const key = storageKey(url);
  const result = await chrome.storage.local.get([key, "baselines"]);
  return result[key] || { baseline: result.baselines?.[normalizeUrl(url)] || null, current: null };
}
async function saveRecord(url, record) {
  try { await chrome.storage.local.set({ [storageKey(url)]: record }); }
  catch (error) { throw new Error(`Could not save locally; the previous baseline is unchanged. Delete unused baselines or retry. ${error.message}`); }
}
async function captureTab(message) {
  const tab = await targetTab(message);
  let interrupted = false;
  const onUpdated = (id, info) => {
    if (id === tab.id && (info.status === "loading" || info.url)) interrupted = true;
  };
  const onActivated = info => {
    if (info.windowId === tab.windowId && info.tabId !== tab.id) interrupted = true;
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onActivated.addListener(onActivated);
  try {
    const inject = () => chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: SeoGuardExtract.extractSeoSnapshot
    });
    const [first] = await inject();
    if (!first?.result || !first.documentId) throw new Error("Capture returned no document.");
    if (normalizeUrl(first.result.url) !== normalizeUrl(message.expectedUrl)) interrupted = true;
    // Respect the browser screenshot rate limit across successive actions.
    const delay = Math.max(0, 600 - (Date.now() - lastScreenshotAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await targetTab(message);
    if (interrupted) throw new Error("Page navigation interrupted capture. Wait for the page to settle and retry.");
    const snapshot = first.result;
    snapshot.warnings = [];
    try {
      lastScreenshotAt = Date.now();
      snapshot.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (error) {
      snapshot.screenshot = null;
      snapshot.warnings.push(`Viewport screenshot unavailable: ${error.message}. Retry capture when the page is ready.`);
    }
    const [last] = await inject();
    await targetTab(message);
    const comparable = value => JSON.stringify({
      url: value.url, title: value.title, metaDescriptions: value.metaDescriptions,
      canonicals: value.canonicals, robots: value.robots, headings: value.headings, anchors: value.anchors
    });
    if (interrupted || !last?.result || first.documentId !== last.documentId || comparable(first.result) !== comparable(last.result)) {
      throw new Error("The page changed during capture. Nothing was saved. Wait for it to settle and retry.");
    }
    return snapshot;
  } finally {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onActivated.removeListener(onActivated);
  }
}
function reportFor(record) {
  if (!record.baseline || !record.current) return null;
  const report = SeoGuardDiff.diffSnapshots(record.baseline, record.current);
  report.warnings = [
    ...(record.baseline.warnings || []).map(w => `Baseline: ${w}`),
    ...(record.current.warnings || []).map(w => `Current: ${w}`)
  ];
  return report;
}
async function handleMessage(message) {
  const tab = await targetTab(message);
  const record = await readRecord(tab.url);
  switch (message.type) {
    case "GET_BASELINE":
      return { ok: true, baseline: record.baseline, lastReport: reportFor(record) };
    case "CAPTURE_BASELINE": {
      if (record.baseline && message.replaceConfirmed !== true) throw new Error("A baseline already exists. Confirm replacement before capturing again.");
      const snapshot = await captureTab(message);
      await saveRecord(tab.url, { baseline: snapshot, current: null });
      return { ok: true, snapshot: { url: snapshot.url, timestamp: snapshot.timestamp }, warnings: snapshot.warnings };
    }
    case "COMPARE_BASELINE": {
      if (!record.baseline) throw new Error("No baseline saved for this page. Capture one first.");
      const current = await captureTab(message);
      if (normalizeUrl(current.url) !== normalizeUrl(record.baseline.url)) throw new Error("Baseline and current page URLs do not match. Nothing was saved.");
      const updated = { baseline: record.baseline, current };
      await saveRecord(tab.url, updated);
      return { ok: true, report: reportFor(updated) };
    }
    case "EXPORT_REPORT":
      if (!record.baseline) throw new Error("No baseline saved for this page.");
      return { ok: true, reportHtml: SeoGuardReport.buildReportHtml(record.baseline, record.current, reportFor(record)) };
    case "DELETE_BASELINE": {
      const old = await chrome.storage.local.get("baselines");
      if (old.baselines && Object.hasOwn(old.baselines, normalizeUrl(tab.url))) {
        delete old.baselines[normalizeUrl(tab.url)];
        await chrome.storage.local.set({ baselines: old.baselines });
      }
      await chrome.storage.local.remove(storageKey(tab.url));
      return { ok: true };
    }
    default: throw new Error("Unknown action.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // Serialize storage updates, including requests from different browser windows.
  const operation = queue.then(() => handleMessage(message));
  queue = operation.catch(() => {});
  operation.then(sendResponse, error => sendResponse({ ok: false, error: error.message || "Operation failed." }));
  return true;
});
