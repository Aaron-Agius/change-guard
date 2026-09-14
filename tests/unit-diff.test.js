const test = require("node:test");
const assert = require("node:assert/strict");
const { diffSnapshots } = require("../lib/diff.js");
const snapshot = () => ({
  url: "http://localhost/page?q=1", timestamp: "2026-09-14T00:00:00Z", title: "Title",
  metaDescriptions: ["One", "Two"], canonicals: ["/canonical"], robots: ["index"],
  headings: [{ level: 1, text: "Heading" }],
  anchors: { internal: ["http://localhost/internal"], external: ["https://other.test/old"], suspicious: ["http://localhost/internal"] },
  screenshot: "data:image/png;base64,AAAA"
});
test("unchanged page with private-address warnings has zero changes and both screenshots", () => {
  const result = diffSnapshots(snapshot(), snapshot());
  assert.equal(result.changeCount, 0);
  assert.equal(result.changes.suspiciousLinks.length, 1);
  assert.equal(result.baselineScreenshot, result.currentScreenshot);
});
test("removed private internal link is detected, not hidden by warning classification", () => {
  const before = snapshot(), after = snapshot();
  after.anchors.internal = [];
  after.anchors.suspicious = [];
  const result = diffSnapshots(before, after);
  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.changes.internalLinksRemoved, ["http://localhost/internal"]);
});
test("title, metadata, heading-level and link changes retain explicit before and after", () => {
  const before = snapshot(), after = snapshot();
  after.title = "Changed";
  after.robots = ["noindex"];
  after.metaDescriptions = ["One"];
  after.headings = [{ level: 2, text: "Heading" }];
  after.anchors.external = ["https://other.test/new"];
  const result = diffSnapshots(before, after);
  assert.equal(result.changeCount, 6);
  assert.equal(result.changes.headings[0].before, "1: Heading");
  assert.equal(result.changes.headings[0].after, "2: Heading");
  assert.equal(result.changes.metaDescriptions[0].type, "removed");
});
test("URL identity ignores fragments, not query parameters", () => {
  const before = snapshot(), after = snapshot();
  after.url += "#anchor";
  assert.equal(diffSnapshots(before, after).urlMatch, true);
  after.url = "http://localhost/page?q=2";
  assert.equal(diffSnapshots(before, after).urlMatch, false);
});
