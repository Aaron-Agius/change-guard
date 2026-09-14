const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
test("popup has all required controls, privacy disclosure and no inline event handlers", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/popup.html"), "utf8");
  for (const id of ["btn-capture", "btn-compare", "btn-export", "btn-delete", "btn-replace-yes", "btn-replace-no"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /sensitive/);
  assert.doesNotMatch(html, /\sonclick=/i);
});
test("popup does not use HTML injection or external resources", () => {
  const js = fs.readFileSync(path.join(__dirname, "../src/popup.js"), "utf8");
  assert.doesNotMatch(js, /\.innerHTML|insertAdjacentHTML|\beval\(/);
  assert.doesNotMatch(js, /\bfetch\(/);
});
