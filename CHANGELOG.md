# Changelog

## 1.0.0

Initial release.

- Capture SEO baseline: title, meta descriptions, canonicals, robots/googlebot directives, H1-H3 headings, internal/external/suspicious links, viewport screenshot
- Compare against baseline with before/after diff
- Export self-contained HTML report
- Delete stored baseline
- Local-only storage, no network calls
- Explicit confirmation required to replace existing baseline
# 1.1.0 - 2026-09-14

- Export the actual latest comparison with both snapshots, timestamps and images.
- Reject navigation, tab switches and SEO-data changes during capture.
- Preserve baseline and comparison across popup sessions; enforce replacement confirmation.
- Separate private-address warnings from changes and track those links normally.
- Surface screenshot/storage errors, escape report content and restrict report resources.
- Use the same extraction and diff code in the runtime and tests.
- Add real-toolbar browser verification, regression tests and local release packaging.
