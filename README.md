# SEO Change Guard

A local-only Chrome/Chromium browser extension that captures a page's SEO baseline and compares it against the same page after edits. All data stays in your browser. Nothing is uploaded.

## What It Does

SEO Change Guard solves a specific problem: you or a developer make changes to a page (deploy a template update, edit CMS content, adjust a plugin) and later discover that something SEO-critical changed without anyone noticing. A canonical was dropped. A meta description was replaced. A heading disappeared. An internal link was removed.

This extension lets you:

1. **Capture a baseline** of a page's rendered SEO-relevant elements before changes are made.
2. **Compare against the baseline** after changes go live, to see exactly what shifted.
3. **Export a report** as a self-contained HTML file for documentation or sharing.
4. **Delete the baseline** when it's no longer needed.

It is a diagnostic tool, not a monitoring service. You choose when to capture and when to compare.

## What It Captures

When you click **Capture Baseline**, the extension reads the currently rendered DOM of the active tab and records:

- **Page URL** (fragment stripped, query parameters preserved)
- **Capture timestamp**
- **Title** (`<title>`)
- **All meta descriptions**, preserving duplicates (invalid multiple tags remain visible)
- **All canonical links**, preserving duplicates
- **All robots and googlebot meta directives**
- **Ordered H1, H2, and H3 headings** with their heading level
- **All anchor link destinations**, resolved against `document.baseURI`, deduplicated, and classified as:
  - **Internal**: same origin as the page
  - **External**: different origin
  - **Suspicious**: private or loopback addresses (localhost, 127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x), shown for review rather than treated as a definitive diagnosis
- **A visible-viewport screenshot**, clearly labelled as viewport-only

Non-navigation link schemes (`javascript:`, `mailto:`, `tel:`, `data:`, `blob:`) are ignored and not stored.

## What It Compares

When you click **Compare With Baseline**, the extension captures the current page the same way and produces a diff report showing:

- **Title**: added, removed, or changed
- **Meta descriptions**: added, removed, or changed (by index)
- **Canonical links**: added, removed, or changed (by index)
- **Robots/googlebot directives**: added, removed, or changed (by index)
- **Headings (H1-H3)**: added, removed, or changed (by position and level)
- **Removed internal link destinations**: URLs that were present in the baseline but are no longer on the page
- **Added external link destinations**: new external URLs that appeared
- **Removed external link destinations**: external URLs that disappeared
- **Suspicious links**: private or loopback addresses present in the current capture, flagged for review
- **Screenshots**: baseline and current screenshots shown side by side

The comparison **never overwrites the baseline**. To replace an existing baseline, you must explicitly confirm via a confirmation dialog.

The extension checks that the current page URL matches the baseline URL (after fragment removal). If the URLs differ, a warning is shown but the comparison is still performed so you can see the differences.

## Loading the Extension

1. Download or clone this repository to your local machine.
2. Open Chrome or Chromium and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Navigate to the `seo-change-guard` directory (the folder containing `manifest.json`) and select it.
6. The extension icon should appear in your toolbar. If it doesn't, click the puzzle piece icon and pin it.

No build step is required. No dependencies to install. No backend or account.

## Usage

### Capturing a Baseline

1. Navigate to the page you want to baseline in your browser.
2. Click the SEO Change Guard extension icon.
3. Click **Capture Baseline**.
4. A success message will appear and the baseline will be stored locally.

If a baseline already exists for the current URL, you will be asked to confirm replacement before the old baseline is overwritten.

### Comparing Against a Baseline

1. After changes have been made (deploy, CMS update, plugin change), navigate to the same URL.
2. Click the extension icon.
3. Click **Compare With Baseline**.
4. The diff report will appear in the popup, showing all detected changes.

The baseline is preserved after comparison. You can compare multiple times.

### Exporting a Report

1. After capturing a baseline (or after comparing), click **Export Report**.
2. A self-contained HTML file will be downloaded to your default downloads folder.
3. Open the file in any browser to view the full baseline report.

The report includes the capture timestamp, page URL, all captured elements, a scope limitation notice, and the screenshot if available.

### Deleting a Baseline

1. Click the extension icon.
2. Click **Delete Baseline**.
3. The stored baseline (including screenshot) will be permanently removed from local storage.

There is no undo for deletion.

## Privacy and Data Handling

- **Nothing is uploaded.** The extension makes no network requests for its core functionality. No analytics, no telemetry, no tracking.
- Baselines (including screenshots) are stored in `chrome.storage.local`, which is local to your browser profile.
- **Saved page content and screenshots may contain sensitive information.** Page text, URLs, and screenshots can reveal internal systems, client names, or personal data. Delete baselines when you no longer need them.
- The **Export Report** feature downloads a file to your local machine. It does not send data anywhere.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's DOM and take a screenshot when you click a button |
| `scripting` | Inject the capture script into the active tab |
| `storage` | Save baselines locally |
| `downloads` | Download the exported report |

No broad host permissions (`<all_urls>`, `<host>`) are requested. The extension only accesses the tab you are actively viewing, and only when you click one of its buttons.

## Limitations

This extension is intentionally narrow in scope. It does **not**:

- Crawl or scan multiple pages or an entire site
- Run on a schedule or monitor pages automatically
- Inspect HTTP response headers, status codes, or server-side rendering
- Detect indexability, ranking impact, or search engine visibility
- Access hidden application state, databases, or backend systems
- Perform pixel-level screenshot comparison
- Provide AI scoring, automated fixes, or recommendations
- Work on restricted browser pages (`chrome://`, `about:`, `edge://`, etc.)
- Capture full-page screenshots (only the visible viewport)
- Detect changes to content loaded dynamically after the initial capture script runs

It reads what is in the DOM at the moment you click capture. If content is rendered client-side after a delay, that content may not be captured. For best results, wait for the page to fully load before capturing.

## Technical Details

- **Manifest Version**: 3
- **Service worker**: `background/service-worker.js`
- **Popup**: `src/popup.html`, `src/popup.css`, `src/popup.js`
- **Storage**: `chrome.storage.local` under the key `baselines`
- **URL normalisation**: fragment stripped via URL API, query parameters preserved
- **Link resolution**: relative URLs resolved against `document.baseURI` using the `URL` constructor
- **Suspicious address detection**: pattern matching for RFC 1918 private ranges, loopback, and localhost
- **XSS protection**: all text rendered via `textContent` (never `innerHTML` with unescaped content); report generation escapes HTML entities

## Testing

The extension includes unit tests and live browser integration tests.

### Unit Tests

```bash
node --test tests/unit-extract.test.js tests/unit-diff.test.js tests/popup-ui.test.js tests/browser-integration.test.js
```

### Live Browser Tests (requires Playwright and a display)

```bash
NODE_PATH=<path-to-playwright-node-modules> xvfb-run --auto-servernum node --test tests/browser-live.test.js
```

The live tests load the extension into Chromium, verify fixture pages, test the popup UI, exercise the capture workflow, and confirm the extension loads without console errors.

## Files

```
manifest.json              Extension manifest (MV3)
background/service-worker.js  Message handling, capture orchestration, diff, report generation
src/popup.html             Popup markup
src/popup.css              Popup styling
src/popup.js               Popup logic and rendering
lib/extract.js             Pure DOM extraction function
lib/diff.js                Pure snapshot comparison function
tests/                     Unit and browser integration tests
fixtures/                  Deterministic test pages
icons/                     Extension icons
screenshots/               Verification screenshots
CONTRACT.md                Internal schema and contract documentation
```

## License

MIT
