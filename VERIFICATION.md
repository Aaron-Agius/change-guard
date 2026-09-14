# Release Verification - 1.1.0

Date: September 14, 2026.

This release was repaired in an isolated checkout because the original
working directory had concurrent writers. GitHub distribution was subsequently
authorized by the owner. No community post was performed.

## Passed

- `npm test`: 22 passed, zero failed, zero skipped.
- `xvfb-run --auto-servernum npm run test:browser`: one complete real-toolbar
  extension workflow passed, zero skipped.
- `git diff --check`: passed.
- `npm run package`: passed, ZIP entries byte-compared after decompression.

The browser workflow loads the unmodified extension manifest in Chromium.
It opens the real action popup using Chrome's debugging API, captures a local
page, closes/reopens the popup, compares unchanged and edited pages, confirms
both screenshots are present, reopens the saved comparison, downloads the
actual HTML report, checks replacement confirmation/cancellation/replacement,
deletes the baseline, and opens the exported report at desktop and mobile widths.

Background tests inject navigation, tab switching, changing SEO data,
screenshot failure, storage failure and concurrent capture requests into the
actual background implementation.

## Evidence

Generated locally under `verification/`:

- `01-baseline.png`
- `02-unchanged.png`
- `03-comparison.png`
- `03-comparison-screenshots.png`
- `04-export.png`
- `05-export-mobile.png`
- `comparison-report.html`

## Scope And Limits

Tested on Chromium on Linux, not every Chrome version or operating system.
Restricted-page and failure cases are covered by runtime tests with mock APIs;
the successful workflow uses a real browser and actual extension permissions.
No production/client page data was used.

The extension detects navigation and changes to captured SEO data around the
screenshot. It cannot make arbitrary visual animation atomic with capture.
It does not certify indexability or ranking impact.

## Sharing

The shareable runtime package is `dist/seo-change-guard-1.1.0.zip`.
Its SHA-256 checksum is in the adjacent `.sha256` file.
Use the v1.1.0 release asset rather than a package from the original v1.0.0 commit.
