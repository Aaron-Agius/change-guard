const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildReportHtml } = require("../lib/report.js");
const { diffSnapshots } = require("../lib/diff.js");
const snapshot = {
  url: "https://example.test/?secret=test", timestamp: "2026-09-14T00:00:00Z", title: "Before",
  metaDescriptions: [], canonicals: [], robots: ["index"], headings: [],
  anchors: { internal: [], external: [], suspicious: [] },
  screenshot: "data:image/png;base64,AAAA"
};
test("comparison export includes before/after, both images and both timestamps", () => {
  const current = { ...snapshot, title: "After", timestamp: "2026-09-14T01:00:00Z", robots: ["noindex"] };
  const html = buildReportHtml(snapshot, current, diffSnapshots(snapshot, current));
  for (const value of ["Before", "After", "noindex", snapshot.timestamp, current.timestamp]) assert.ok(html.includes(value));
  assert.equal((html.match(/<img src=/g) || []).length, 2);
  assert.match(html, /Comparison Report/);
});
test("export escapes hostile text and rejects non-image screenshot sources", () => {
  const hostile = { ...snapshot, title: '<img src=x onerror="alert(1)">', screenshot: 'x" onerror="alert(1)' };
  const html = buildReportHtml(hostile, null, null);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<img src="x/);
  assert.match(html, /Screenshot unavailable/);
  assert.match(html, /default-src 'none'/);
});
