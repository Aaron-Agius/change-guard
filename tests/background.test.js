const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function harness() {
  const data = {};
  let listener;
  const events = { updated: new Set(), activated: new Set() };
  const state = {
    tab: { id: 1, active: true, windowId: 1, url: "https://example.test/page?q=1" },
    screenshotError: false, storageError: false, navigation: false, swappedTab: false,
    title: "Before", documentId: "doc-1", injectionCount: 0, mutateDuringCapture: false
  };
  const snapshot = () => ({
    url: state.tab.url, timestamp: new Date().toISOString(), title: state.title,
    metaDescriptions: ["One", "Two"], canonicals: ["https://example.test/page"],
    robots: ["index"], headings: [{ level: 1, text: "Heading" }],
    anchors: { internal: ["https://example.test/internal"], external: [], suspicious: [] },
    screenshot: null, screenshotLabel: "viewport-only"
  });
  const event = set => ({ addListener: fn => set.add(fn), removeListener: fn => set.delete(fn) });
  const context = vm.createContext({
    URL, console, setTimeout: fn => setTimeout(fn, 0),
    chrome: {
      runtime: { id: "extension-id", onMessage: { addListener: fn => { listener = fn; } } },
      tabs: {
        get: async () => ({ ...state.tab }),
        onUpdated: event(events.updated), onActivated: event(events.activated),
        captureVisibleTab: async () => {
          if (state.navigation) {
            events.updated.forEach(fn => fn(1, { status: "loading" }));
            state.documentId = "doc-2";
          }
          if (state.swappedTab) events.activated.forEach(fn => fn({ windowId: 1, tabId: 2 }));
          if (state.screenshotError) throw new Error("Screenshot rate limit");
          return "data:image/png;base64,AAAA";
        }
      },
      scripting: { executeScript: async () => {
        state.injectionCount++;
        if (state.mutateDuringCapture && state.injectionCount % 2 === 0) state.title = "Changed mid-capture";
        return [{ documentId: state.documentId, result: snapshot() }];
      } },
      storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, structuredClone(data[k])])),
        set: async values => { if (state.storageError) throw new Error("Quota exceeded"); Object.assign(data, structuredClone(values)); },
        remove: async key => { delete data[key]; }
      } }
    }
  });
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.resolve(root, "background", file), "utf8"), context);
  };
  vm.runInContext(fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8"), context);
  const send = (type, extra = {}) => new Promise(resolve => listener({
    type, tabId: 1, expectedUrl: state.tab.url, ...extra
  }, { id: "extension-id" }, resolve));
  return { state, data, send, events };
}

test("runtime captures, compares without overwriting, exports comparison and deletes", async () => {
  const h = harness();
  assert.equal((await h.send("COMPARE_BASELINE")).ok, false);
  assert.equal((await h.send("CAPTURE_BASELINE")).ok, true);
  const key = "page:https://example.test/page?q=1";
  const baseline = structuredClone(h.data[key].baseline);
  assert.equal((await h.send("CAPTURE_BASELINE")).ok, false);
  const clean = await h.send("COMPARE_BASELINE");
  assert.equal(clean.report.changeCount, 0);
  h.state.title = '<script>alert("unsafe")</script>';
  const changed = await h.send("COMPARE_BASELINE");
  assert.equal(changed.report.changeCount, 1);
  assert.deepEqual(h.data[key].baseline, baseline);
  const html = (await h.send("EXPORT_REPORT")).reportHtml;
  assert.match(html, /Comparison Report/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Before/);
  assert.equal((await h.send("GET_BASELINE")).lastReport.changeCount, 1);
  assert.equal((await h.send("DELETE_BASELINE")).ok, true);
  assert.equal((await h.send("GET_BASELINE")).baseline, null);
});

test("confirmed replacement clears old comparison and records new baseline", async () => {
  const h = harness();
  await h.send("CAPTURE_BASELINE");
  h.state.title = "New";
  await h.send("COMPARE_BASELINE");
  await h.send("CAPTURE_BASELINE", { replaceConfirmed: true });
  const r = await h.send("GET_BASELINE");
  assert.equal(r.baseline.title, "New");
  assert.equal(r.lastReport, null);
});

test("navigation or tab switch during screenshot rejects capture and preserves baseline", async () => {
  for (const interruption of ["navigation", "swappedTab"]) {
    const h = harness();
    await h.send("CAPTURE_BASELINE");
    const old = structuredClone(h.data);
    h.state[interruption] = true;
    const r = await h.send("CAPTURE_BASELINE", { replaceConfirmed: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /changed during capture/);
    assert.deepEqual(h.data, old);
    assert.equal(h.events.updated.size, 0);
    assert.equal(h.events.activated.size, 0);
  }
});

test("screenshot failure is an explicit partial-capture warning", async () => {
  const h = harness();
  h.state.screenshotError = true;
  const r = await h.send("CAPTURE_BASELINE");
  assert.equal(r.ok, true);
  assert.match(r.warnings[0], /Screenshot rate limit/);
  const saved = await h.send("GET_BASELINE");
  assert.equal(saved.baseline.screenshot, null);
  assert.match((await h.send("EXPORT_REPORT")).reportHtml, /Screenshot unavailable/);
});

test("quota failure preserves prior record and reports an actionable error", async () => {
  const h = harness();
  await h.send("CAPTURE_BASELINE");
  const old = structuredClone(h.data);
  h.state.storageError = true;
  h.state.title = "After";
  const r = await h.send("COMPARE_BASELINE");
  assert.equal(r.ok, false);
  assert.match(r.error, /Could not save locally/);
  assert.deepEqual(h.data, old);
});

test("wrong URL, inactive tab and browser pages fail closed", async () => {
  const h = harness();
  assert.equal((await h.send("CAPTURE_BASELINE", { expectedUrl: "https://different.test/" })).ok, false);
  h.state.tab.active = false;
  assert.equal((await h.send("CAPTURE_BASELINE")).ok, false);
  h.state.tab.active = true;
  h.state.tab.url = "chrome://settings/";
  const r = await h.send("CAPTURE_BASELINE");
  assert.equal(r.ok, false);
  assert.match(r.error, /Only HTTP/);
  assert.deepEqual(h.data, {});
});

test("legacy baseline is readable and deletion cannot resurrect it", async () => {
  const h = harness();
  h.data.baselines = { [h.state.tab.url]: { url: h.state.tab.url, title: "Legacy" } };
  assert.equal((await h.send("GET_BASELINE")).baseline.title, "Legacy");
  await h.send("DELETE_BASELINE");
  assert.equal((await h.send("GET_BASELINE")).baseline, null);
});

test("SEO data changing during screenshot rejects an inconsistent capture", async () => {
  const h = harness();
  h.state.mutateDuringCapture = true;
  const response = await h.send("CAPTURE_BASELINE");
  assert.equal(response.ok, false);
  assert.match(response.error, /changed during capture/);
  assert.deepEqual(h.data, {});
});

test("concurrent first captures cannot overwrite without confirmation", async () => {
  const h = harness();
  const responses = await Promise.all([h.send("CAPTURE_BASELINE"), h.send("CAPTURE_BASELINE")]);
  assert.equal(responses.filter(r => r.ok).length, 1);
  assert.equal(responses.filter(r => !r.ok).length, 1);
});
