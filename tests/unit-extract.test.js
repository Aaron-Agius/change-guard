const test = require("node:test");
const assert = require("node:assert/strict");
const { extractSeoSnapshot } = require("../lib/extract.js");
function node(attrs = {}, text = "", tag = "") {
  return { getAttribute: name => attrs[name] ?? null, textContent: text, tagName: tag };
}
function document(options = {}) {
  const groups = {
    "meta[name]": options.meta || [],
    "link[rel]": options.links || [],
    "a[href]": (options.anchors || []).map(href => node({ href })),
    "h1, h2, h3": options.headings || []
  };
  return {
    URL: options.url || "https://example.test/page?q=1#section",
    baseURI: options.base || options.url || "https://example.test/page?q=1",
    title: options.title || "Fixture",
    querySelectorAll: selector => groups[selector] || []
  };
}
test("preserves duplicate and case-insensitive metadata, resolves canonicals, keeps query", () => {
  const result = extractSeoSnapshot(document({
    meta: [node({ name: "Description", content: "One" }), node({ name: "description", content: "Two" }),
      node({ name: "ROBOTS", content: "noindex" }), node({ name: "GoogleBot", content: "nofollow" })],
    links: [node({ rel: "CANONICAL", href: "/canonical" }), node({ rel: "alternate canonical", href: "/other" })]
  }));
  assert.equal(result.url, "https://example.test/page?q=1");
  assert.deepEqual(result.metaDescriptions, ["One", "Two"]);
  assert.deepEqual(result.robots, ["noindex", "googlebot: nofollow"]);
  assert.deepEqual(result.canonicals, ["https://example.test/canonical", "https://example.test/other"]);
});
test("cross-origin base affects resolution but not page-origin classification", () => {
  const result = extractSeoSnapshot(document({
    base: "https://cdn.test/folder/", anchors: ["child", "https://example.test/internal", "child"]
  }));
  assert.deepEqual(result.anchors.internal, ["https://example.test/internal"]);
  assert.deepEqual(result.anchors.external, ["https://cdn.test/folder/child"]);
});
test("private links remain internal or external while also flagged", () => {
  const result = extractSeoSnapshot(document({
    url: "http://127.0.0.1:3000/page", anchors: ["/internal", "http://192.168.1.1/a", "http://localhost.evil.test/", "http://[::1]/"]
  }));
  assert.deepEqual(result.anchors.internal, ["http://127.0.0.1:3000/internal"]);
  assert.equal(result.anchors.suspicious.length, 3);
  assert.ok(!result.anchors.suspicious.some(u => u.includes("evil.test")));
});
test("hostile text stays data, non-navigation schemes ignored, heading text not truncated", () => {
  const text = '<img src=x onerror=alert(1)>' + "x".repeat(600);
  const result = extractSeoSnapshot(document({
    title: text, meta: [node({ name: "description", content: text })],
    headings: [node({}, text, "H3")],
    anchors: ["javascript:alert(1)", "mailto:x@test", "tel:1", "data:text/html,x", "blob:https://example.test/x", "ftp://test/a", "/real"]
  }));
  assert.equal(result.title, text);
  assert.equal(result.headings[0].text, text);
  assert.equal(result.anchors.internal.length, 1);
  assert.equal(result.anchors.external.length, 0);
});
test("empty canonical is not silently converted to current URL", () => {
  const result = extractSeoSnapshot(document({ links: [node({ rel: "canonical", href: "" })] }));
  assert.deepEqual(result.canonicals, [""]);
});
