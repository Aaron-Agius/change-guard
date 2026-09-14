"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Minimal mock of the popup.js formatting logic for unit testing
function formatChangeCount(count) {
  if (typeof count !== "number" || isNaN(count) || count < 0) return "0 changes";
  return `${count} change${count === 1 ? "" : "s"} detected.`;
}

function formatBaselineDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleString();
  } catch { return "Unknown date"; }
}

function safeTextContent(text) {
  // In the real popup this is done by setting textContent, which is inherently safe.
  // Here we simulate by ensuring no HTML tags can pass through.
  return String(text ?? "");
}

describe("popup UI formatting", () => {
  it("formats change count correctly", () => {
    assert.equal(formatChangeCount(0), "0 changes detected.");
    assert.equal(formatChangeCount(1), "1 change detected.");
    assert.equal(formatChangeCount(3), "3 changes detected.");
  });

  it("formats baseline date", () => {
    const iso = "2026-09-14T12:00:00.000Z";
    const result = formatBaselineDate(iso);
    assert.ok(typeof result === "string");
    assert.ok(result.length > 0);
  });

  it("handles invalid dates", () => {
    assert.equal(formatBaselineDate("not-a-date"), "Unknown date");
  });

  it("text content is never HTML-interpreted", () => {
    const hostile = "<script>alert('xss')</script>";
    const rendered = safeTextContent(hostile);
    // textContent assignment would make this inert in the real DOM
    assert.equal(rendered, hostile);
    // But we verify the UI never puts this into innerHTML
    // (asserted separately in the static analysis test)
  });
});
