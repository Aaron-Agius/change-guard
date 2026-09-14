# SEO Change Guard

A local-only Chrome/Chromium extension for checking what changed on a page
after a site edit. Capture before editing, compare afterwards, and export
a self-contained before/after report. No account, API keys or backend.

## Install

Get the **seo-change-guard-1.1.0.zip** asset from the
[latest release](https://github.com/Aaron-Agius/change-guard/releases/latest).
The release ZIP contains only the extension and its documentation.

1. Download and unzip the release package, or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, then select the folder containing `manifest.json`.
   In the release ZIP this folder is `seo-change-guard`.
4. Pin SEO Change Guard using Chrome's extensions menu.

No build or dependency installation is required to use the extension.
Desktop Chrome/Chromium only. This is an unpacked extension, not a Chrome Web
Store installation. Keep its folder on disk. To update, replace the files
in the same folder and click Reload on its extension card.

## Use

1. Open an HTTP/HTTPS page and wait for it to settle.
2. Click the extension icon, then **Capture Baseline**.
3. Edit your site, reload that same page, then choose **Compare With Baseline**.
4. Inspect before/after values, warnings and both viewport screenshots.
5. Choose **Export Report** to download the latest saved comparison as HTML.
   Before the first comparison, export produces a baseline-only report.
6. **Delete Baseline** removes that page's baseline and saved comparison.

Comparison never replaces the baseline. Replacing it requires confirmation
and clears the previous comparison. The latest comparison survives closing
and reopening the popup.

The page key preserves query parameters and removes the URL fragment.
Different paths or query strings get different baselines. Navigation or
changing tabs during capture is rejected. If SEO data changes while a
screenshot is being taken, retry after the page settles.

## Captured Data

- Title, all meta descriptions and all canonical links, including duplicates.
- Robots and Googlebot meta directives.
- Ordered H1-H3 headings.
- Deduplicated HTTP/HTTPS anchor destinations resolved against `document.baseURI`.
- Internal/external classification against the actual page origin.
- Private-address links as review warnings, independent of change counts.
- Timestamped visible-viewport screenshots.

Reports show metadata and heading differences, removed internal links, and
added/removed external links. Metadata and headings are compared by position;
inserting or reordering them can produce multiple differences.

Screenshots are available even when there are no observed SEO changes.
Screenshot failure produces a visible partial-capture warning, not a
false claim that an image was captured.

## Privacy

The extension makes no network requests. Captures and the latest comparison
are saved in `chrome.storage.local`, not uploaded or synced by this extension.
The page you visit may make its own network requests independently.

**Page URLs, text and screenshots may contain confidential information.**
Review exported files before sharing them. Delete unneeded baselines.
Deleting a baseline does not delete reports you already downloaded.
Removing the extension removes its extension storage.

Images can consume the browser's storage allowance. If a save fails, the
extension reports the error and leaves the previous record unchanged.
Open pages with old baselines and delete them to free space.

Permissions: `activeTab` for user-initiated page access/screenshots,
`scripting` for DOM extraction, and `storage` for local records.
No persistent host access, analytics, remote scripts or download permission.

## Scope

This is a single-page, manual comparison tool. It does not:

- Crawl sites, monitor in the background or make automatic changes.
- Check HTTP headers, response status, indexability or ranking impact.
- Capture full-page screenshots, inspect cross-origin frames or compare pixels.
- Certify a page or website as correct.
- Run on browser settings, extension pages, local files or other restricted pages.

It observes rendered DOM data at capture time, not hidden application state.
Arbitrary animations and unrelated visual updates cannot be made atomic with
a browser screenshot; navigation and changes to the captured SEO data are
checked and rejected.

## Development And Verification

Requires Node.js, npm and a supported Chromium test environment.

```bash
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

On Linux without a desktop display:

```bash
xvfb-run --auto-servernum npm run test:browser
```

The browser test requires a Chromium version supporting the extension-action
debugging API. It loads the unmodified manifest, triggers the real toolbar
action, interacts with the real popup and uses local fixture pages only.
It fails rather than treating capture permission errors as success.
Failure-injection tests execute the actual background implementation with
mock Chrome APIs. Unit tests exercise the same extraction/diff/report code
used by the extension.

Browser evidence is written to `verification/` and is not included in releases.

```bash
npm run package
```

Packaging uses the installed development dependencies. It creates a runtime-only ZIP and SHA-256
checksum in `dist/`. Tests, fixtures, dependencies and captured evidence are
excluded. Packaging does not publish anything.

## License

MIT. See `LICENSE`.
