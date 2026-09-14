chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("baselines", (result) => {
    if (!result.baselines) chrome.storage.local.set({ baselines: {} });
  });
});

function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    url.hash = "";
    return url.toString();
  } catch {
    return urlString;
  }
}

async function captureTab(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== tabId) throw new Error("Tab not found or not active");

  const restrictedPatterns = [
    /^chrome:\/\//i, /^chrome-extension:\/\//i, /^edge:\/\//i,
    /^about:/i, /^moz-extension:\/\//i, /^devtools:/i
  ];
  if (restrictedPatterns.some(p => p.test(tab.url ?? ""))) {
    throw new Error("Cannot capture on restricted browser pages (chrome://, about:, etc.)");
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const META_DESC = document.querySelectorAll("meta[name=\"description\"], meta[name=\"description\" i]");
        const CANONICAL = document.querySelectorAll("link[rel=\"canonical\"]");
        const ROBOTS = document.querySelectorAll("meta[name=\"robots\"], meta[name=\"googlebot\"]");
        const HEADINGS = document.querySelectorAll("h1, h2, h3");
        const ANCHORS = document.querySelectorAll("a[href]");

        const baseUri = document.baseURI || location.href;
        const origin = new URL(baseUri).origin;

        const metaDescriptions = Array.from(META_DESC).map(m => (m.getAttribute("content") || "").trim());
        const canonicals = Array.from(CANONICAL).map(l => {
          try { return new URL(l.getAttribute("href") || "", baseUri).toString(); }
          catch { return l.getAttribute("href") || ""; }
        });
        const robots = Array.from(ROBOTS).map(m => {
          const name = (m.getAttribute("name") || "").toLowerCase();
          const content = (m.getAttribute("content") || "").trim();
          return name === "googlebot" ? `googlebot: ${content}` : content;
        });
        const headings = Array.from(HEADINGS).map(h => ({
          level: parseInt(h.tagName.slice(1), 10),
          text: (h.textContent || "").trim().slice(0, 500)
        }));

        const IGNORED_SCHEMES = /^javascript:|mailto:|tel:|data:|blob:/i;
        const SUSPICIOUS_RE = /^https?:\/\/(localhost|127\.0\.0\.1|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2\d|3[01])\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+)/i;

        const internal = new Set();
        const external = new Set();
        const suspicious = new Set();

        for (const a of ANCHORS) {
          const raw = a.getAttribute("href") || "";
          if (!raw || IGNORED_SCHEMES.test(raw)) continue;
          try {
            const resolved = new URL(raw, baseUri).toString();
            if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) continue;
            if (SUSPICIOUS_RE.test(resolved)) { suspicious.add(resolved); continue; }
            if (new URL(resolved).origin === origin) internal.add(resolved);
            else external.add(resolved);
          } catch { /* unresolvable href */ }
        }

        return {
          url: location.href.split("#")[0],
          timestamp: new Date().toISOString(),
          title: document.title,
          metaDescriptions,
          canonicals,
          robots,
          headings,
          anchors: {
            internal: Array.from(internal).sort(),
            external: Array.from(external).sort(),
            suspicious: Array.from(suspicious).sort()
          },
          screenshot: null,
          screenshotLabel: "viewport-only"
        };
      }
    });
  } catch (err) {
    throw new Error(`Failed to execute capture script: ${err.message}`);
  }

  if (!results || results.length === 0 || !results[0].result) {
    throw new Error("Capture script returned no data");
  }

  const snapshot = results[0].result;

  // Capture visible-viewport screenshot
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    snapshot.screenshot = dataUrl;
  } catch {
    snapshot.screenshot = null;
  }

  return snapshot;
}

async function getBaseline(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  const key = normalizeUrl(tab.url || "");
  const result = await chrome.storage.local.get("baselines");
  const baselines = result.baselines || {};
  return baselines[key] || null;
}

async function storeBaseline(tabId, snapshot) {
  const key = normalizeUrl(snapshot.url);
  const result = await chrome.storage.local.get("baselines");
  const baselines = result.baselines || {};
  baselines[key] = snapshot;
  await chrome.storage.local.set({ baselines });
}

async function deleteBaseline(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  const key = normalizeUrl(tab.url || "");
  const result = await chrome.storage.local.get("baselines");
  const baselines = result.baselines || {};
  delete baselines[key];
  await chrome.storage.local.set({ baselines });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "CAPTURE_BASELINE": {
          const snapshot = await captureTab(message.tabId);
          await storeBaseline(message.tabId, snapshot);
          sendResponse({ ok: true, snapshot: { url: snapshot.url, timestamp: snapshot.timestamp } });
          break;
        }
        case "GET_BASELINE": {
          const baseline = await getBaseline(message.tabId);
          sendResponse({ ok: true, baseline });
          break;
        }
        case "DELETE_BASELINE": {
          await deleteBaseline(message.tabId);
          sendResponse({ ok: true });
          break;
        }
        case "COMPARE_BASELINE": {
          const baseline = await getBaseline(message.tabId);
          if (!baseline) {
            sendResponse({ ok: false, error: "No baseline saved for this page. Capture one first." });
            break;
          }
          const current = await captureTab(message.tabId);
          const diff = buildDiff(baseline, current);
          sendResponse({ ok: true, report: diff });
          break;
        }
        case "EXPORT_REPORT": {
          const baseline = await getBaseline(message.tabId);
          if (!baseline) {
            sendResponse({ ok: false, error: "No baseline saved for this page." });
            break;
          }
          const report = buildReportHtml(baseline);
          sendResponse({ ok: true, reportHtml: report });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || "Unknown error" });
    }
  })();
  return true; // Keep the message channel open for async response
});

function buildDiff(baseline, current) {
  const changes = {};
  let changeCount = 0;

  const urlMatch = normalizeUrl(baseline.url) === normalizeUrl(current.url);

  // Title
  if (baseline.title !== current.title) {
    changes.title = { before: baseline.title, after: current.title };
    changeCount++;
  }

  // Meta descriptions (by index)
  const maxDesc = Math.max(baseline.metaDescriptions.length, current.metaDescriptions.length);
  changes.metaDescriptions = [];
  for (let i = 0; i < maxDesc; i++) {
    const b = baseline.metaDescriptions[i] ?? null;
    const c = current.metaDescriptions[i] ?? null;
    if (b !== c) {
      changes.metaDescriptions.push({ index: i, before: b, after: c, type: b === null ? "added" : c === null ? "removed" : "changed" });
      changeCount++;
    }
  }

  // Canonicals (by index)
  const maxCanon = Math.max(baseline.canonicals.length, current.canonicals.length);
  changes.canonicals = [];
  for (let i = 0; i < maxCanon; i++) {
    const b = baseline.canonicals[i] ?? null;
    const c = current.canonicals[i] ?? null;
    if (b !== c) {
      changes.canonicals.push({ index: i, before: b, after: c, type: b === null ? "added" : c === null ? "removed" : "changed" });
      changeCount++;
    }
  }

  // Robots (by index)
  const maxRobots = Math.max(baseline.robots.length, current.robots.length);
  changes.robots = [];
  for (let i = 0; i < maxRobots; i++) {
    const b = baseline.robots[i] ?? null;
    const c = current.robots[i] ?? null;
    if (b !== c) {
      changes.robots.push({ index: i, before: b, after: c, type: b === null ? "added" : c === null ? "removed" : "changed" });
      changeCount++;
    }
  }

  // Headings (by index)
  const maxHeadings = Math.max(baseline.headings.length, current.headings.length);
  changes.headings = [];
  for (let i = 0; i < maxHeadings; i++) {
    const b = baseline.headings[i] ?? null;
    const c = current.headings[i] ?? null;
    if (!b || !c || b.level !== c.level || b.text !== c.text) {
      changes.headings.push({
        index: i,
        level: b?.level ?? c?.level,
        before: b ? `${b.level}: ${b.text}` : null,
        after: c ? `${c.level}: ${c.text}` : null,
        type: !b ? "added" : !c ? "removed" : "changed"
      });
      changeCount++;
    }
  }

  // Internal links removed
  const currentInternal = new Set(current.anchors.internal);
  changes.internalLinksRemoved = baseline.anchors.internal.filter(u => !currentInternal.has(u));
  changeCount += changes.internalLinksRemoved.length;

  // External links added/removed
  const currentExternal = new Set(current.anchors.external);
  const baselineExternal = new Set(baseline.anchors.external);
  changes.externalLinksAdded = current.anchors.external.filter(u => !baselineExternal.has(u));
  changes.externalLinksRemoved = baseline.anchors.external.filter(u => !currentExternal.has(u));
  changeCount += changes.externalLinksAdded.length + changes.externalLinksRemoved.length;

  // Suspicious links
  changes.suspiciousLinks = current.anchors.suspicious.filter(u => {
    const wasSuspicious = baseline.anchors.suspicious.includes(u);
    return !wasSuspicious || true; // Always show as review if present
  });
  if (changes.suspiciousLinks.length > 0) changeCount += changes.suspiciousLinks.length;

  return {
    url: current.url,
    urlMatch,
    changes,
    changeCount,
    baselineTimestamp: baseline.timestamp,
    currentTimestamp: current.timestamp,
    baselineScreenshot: baseline.screenshot,
    currentScreenshot: current.screenshot
  };
}

function buildReportHtml(baseline) {
  const esc = (s) => {
    const div = { textContent: s };
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  const ts = baseline.timestamp || "unknown";
  const rows = [];
  rows.push(`<tr><th>Title</th><td>${esc(baseline.title)}</td></tr>`);
  baseline.metaDescriptions.forEach((d, i) => rows.push(`<tr><th>Meta description ${i + 1}</th><td>${esc(d)}</td></tr>`));
  baseline.canonicals.forEach((c, i) => rows.push(`<tr><th>Canonical ${i + 1}</th><td>${esc(c)}</td></tr>`));
  baseline.robots.forEach((r, i) => rows.push(`<tr><th>Robots ${i + 1}</th><td>${esc(r)}</td></tr>`));
  baseline.headings.forEach((h, i) => rows.push(`<tr><th>H${h.level} heading ${i + 1}</th><td>${esc(h.text)}</td></tr>`));
  baseline.anchors.internal.forEach(u => rows.push(`<tr><th>Internal link</th><td>${esc(u)}</td></tr>`));
  baseline.anchors.external.forEach(u => rows.push(`<tr><th>External link</th><td>${esc(u)}</td></tr>`));
  if (baseline.anchors.suspicious.length > 0) {
    baseline.anchors.suspicious.forEach(u => rows.push(`<tr><th>Suspicious link (review)</th><td>${esc(u)}</td></tr>`));
  }
  const hasScreenshot = baseline.screenshot ? "Yes (see below)" : "Not available";
  rows.push(`<tr><th>Screenshot</th><td>${hasScreenshot}</td></tr>`);

  return `<!DOCTYPE html>
<html>
<head><title>SEO Change Guard Report - ${esc(baseline.url)}</title><style>body{font-family:monospace;max-width:800px;margin:2em auto;padding:0 1em}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f5f5f5;font-weight:bold;min-width:180px}img{max-width:100%;border:1px solid #ccc;margin-top:8px}.meta{color:#666;font-size:0.85em;margin:1em 0}</style></head>
<body>
<h1>SEO Change Guard Baseline Report</h1>
<p class="meta">Captured: ${esc(ts)} | URL: ${esc(baseline.url)}</p>
<p class="meta"><strong>Scope limitations:</strong> This report covers the rendered DOM and viewport screenshot only. It does not inspect HTTP headers, status codes, indexability, ranking impact, hidden application state, or the full site.</p>
<table><tbody>${rows.join("\n")}</tbody></table>
${baseline.screenshot ? `<img src="${baseline.screenshot}" alt="Viewport screenshot at baseline capture" style="max-width:100%;margin-top:16px;border:1px solid #ccc;" />` : ""}
${baseline.screenshot ? `<p class="meta">Screenshot is viewport-only.</p>` : ""}
</body></html>`;
}
