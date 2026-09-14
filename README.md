# SEO Change Guard

A local-only Chrome/Chromium browser extension that captures a page's SEO baseline and compares it against the same page after edits. All data stays in your browser.

## Use

1. Load the unpacked extension from `chrome://extensions` (enable Developer Mode, click "Load unpacked", select this directory).
2. Navigate to any page you want to baseline.
3. Click the extension icon, then **Capture Baseline**.
4. After making edits (deploy, CMS change, template update), revisit the same URL and click **Compare With Baseline**.
5. Review the diff. Use **Export Report** to download a self-contained HTML report.

## Privacy

- **Nothing is uploaded.** No analytics, no telemetry, no external API calls.
- Baselines (including screenshots) are stored in `chrome.storage.local` on your machine.
- **Saved page content and screenshots may contain sensitive information.** Delete baselines when you no longer need them using **Delete Baseline**.

## Permissions

- `activeTab` — read the current tab's DOM and take a viewport screenshot when you click a button.
- `scripting` — inject the capture script into the active tab.
- `storage` — save baselines locally.
- `downloads` — download the exported report.

## Limitations

- One page at a time. No crawling, scheduling, or full-site scanning.
- Manual capture and comparison only. No automatic monitoring.
- Screenshot is viewport-only, not full-page.
- Does not inspect HTTP headers, status codes, indexability, ranking impact, hidden application state, or the full site.
- Does not work on `chrome://`, `about:`, or other restricted browser pages.
- Cannot read server-rendered HTML that differs from the client-rendered DOM.
- No AI scoring, automatic fixes, or pixel-diff engine.
