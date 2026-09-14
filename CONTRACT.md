# SEO Change Guard - Shared Contract

## File Ownership
- manifest.json + background/ + integration: PRIMARY
- lib/extract.js + lib/diff.js + tests/unit-*.test.js: CAPTURE/DIFF WORKER
- src/popup.html + src/popup.css + src/popup.js + src/popup-ui.test.js: UI WORKER
- tests/browser-*.test.js + fixtures/ + verification: VERIFICATION WORKER (no impl edits)

## Snapshot Schema

Storage key: `page:<full URL without fragment>`.
Value: `{ baseline: Snapshot, current: Snapshot | null }`.
The legacy `baselines` map is read for compatibility and cleaned on deletion.
`suspicious` overlaps internal/external classification; it is a warning, not a change.
Snapshots also contain `warnings: string[]` for partial screenshot captures.

Snapshot example:
{
  "https://example.com/page?x=1": {
    "url": "https://example.com/page?x=1",
    "timestamp": "2026-09-14T12:00:00.000Z",
    "title": "Page Title",
    "metaDescriptions": ["desc1", "desc2"],
    "canonicals": ["https://example.com/canonical"],
    "robots": ["noindex, nofollow"],
    "headings": [{ "level": 1, "text": "Main Heading" }, ...],
    "anchors": {
      "internal": ["https://example.com/link1", ...],
      "external": ["https://external.com/link", ...],
      "suspicious": ["http://localhost/...", "http://192.168.1.1/...", ...]
    },
    "screenshot": "data:image/png;base64,...",
    "screenshotLabel": "viewport-only"
  }
}

## Baseline Key = full URL minus fragment (URL API, query params preserved)

## Message Types (popup -> background service worker)

Every message includes `{ type, tabId, expectedUrl }`. The background checks
the tab is still active and its normalized URL matches.

- CAPTURE_BASELINE: optional `replaceConfirmed: true`; required for replacement.
- COMPARE_BASELINE: returns `{ ok, report?, error? }`; persists latest comparison.
- DELETE_BASELINE: deletes baseline and latest comparison.
- GET_BASELINE: returns `{ ok, baseline, lastReport }`.
- EXPORT_REPORT: returns `{ ok, reportHtml }` for latest comparison, or baseline-only.

Capture returns `{ ok, snapshot: { url, timestamp }, warnings }`.
Errors return `{ ok: false, error }`. Operations are serialized in the background.

## Capture Uses chrome.scripting.executeScript with func returning snapshot data.
## Screenshot via chrome.tabs.captureVisibleTab.

## Diff Result Schema
{
  "url": "...",
  "urlMatch": true,
  "changes": {
    "title": { "before": "...", "after": "..." } | null,
    "metaDescriptions": [{ "index", "before", "after", "type": "added|removed|changed" }],
    "canonicals": [{ "index", "before", "after", "type" }],
    "robots": [{ "index", "before", "after", "type" }],
    "headings": [{ "index", "level", "before", "after", "type" }],
    "internalLinksRemoved": ["url", ...],
    "externalLinksAdded": ["url", ...],
    "externalLinksRemoved": ["url", ...],
    "suspiciousLinks": ["url", ...]
  },
  "changeCount": 0,
  "baselineTimestamp": "...",
  "currentTimestamp": "..."
}

## Screenshot Comparison: show both images side by side, baseline left, current right.

## Safety Rules (all workers must follow):
- Render all text via textContent or a safe escape. NEVER innerHTML with unescaped content.
- Ignore non-navigation schemes: javascript:, mailto:, tel:, data:, blob:
- Resolve relative URLs against document.baseURI using URL API.
- Suspicious patterns: localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x
- Preserve duplicate meta descriptions and canonicals.
