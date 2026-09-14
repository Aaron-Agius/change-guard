const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");

test("unmodified extension: capture, compare, reopen, export, confirmation, delete", { timeout: 120000 }, async () => {
  let modified = false;
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>${modified ? "After title" : "Before title"}</title>
<meta name="description" content="One"><meta name="description" content="Two">
<meta name="ROBOTS" content="${modified ? "noindex" : "index"}">
<meta name="GoogleBot" content="nofollow"><link rel="canonical" href="/${modified ? "new" : "old"}">
</head><body><h1>SEO fixture</h1>${modified ? "" : '<h2>Removed heading</h2><a href="/internal">Internal</a>'}
<a href="https://example.org/${modified ? "new" : "old"}">External</a>
<p>&lt;img src=x onerror=alert(1)&gt;</p></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "seo-guard-verified-"));
  const evidence = path.join(root, "verification");
  fs.mkdirSync(evidence, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: false, chromiumSandbox: false,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--enable-unsafe-extension-debugging"],
      viewport: { width: 1100, height: 750 }
    });
    const errors = [];
    context.on("weberror", error => errors.push(error.error().message));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = worker.url().split("/")[2];
    const page = context.pages()[0];
    const url = `http://127.0.0.1:${server.address().port}/page?q=1`;
    await page.goto(url);
    const cdp = await context.browser().newBrowserCDPSession();
    async function poll(fn, message) {
      for (let i = 0; i < 100; i++) {
        const result = await fn();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(message);
    }
    async function popup() {
      const targets = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] });
      const tab = targets.targetInfos.find(t => t.url === page.url());
      await cdp.send("Extensions.triggerAction", { id, targetId: tab.targetId });
      const target = await poll(async () => {
        const all = await cdp.send("Target.getTargets", { filter: [{}] });
        return all.targetInfos.find(t => t.url === `chrome-extension://${id}/src/popup.html`);
      }, "Real toolbar popup did not open");
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
      let seq = 0;
      const pending = new Map();
      const receive = event => {
        if (event.sessionId !== sessionId) return;
        const data = JSON.parse(event.message);
        const handler = pending.get(data.id);
        if (handler) { pending.delete(data.id); data.error ? handler.reject(new Error(data.error.message)) : handler.resolve(data.result); }
      };
      cdp.on("Target.receivedMessageFromTarget", receive);
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const command = ++seq;
        pending.set(command, { resolve, reject });
        cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: command, method, params }) }).catch(reject);
      });
      const evaluate = async expression => {
        const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      await poll(() => evaluate('document.readyState==="complete" && !!document.querySelector("#btn-capture")'), "Popup not ready");
      return {
        evaluate,
        click: selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),
        text: selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`),
        close: async () => { await cdp.send("Target.closeTarget", { targetId: target.targetId }); cdp.off("Target.receivedMessageFromTarget", receive); },
        screenshot: async name => {
          const result = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          fs.writeFileSync(path.join(evidence, name), Buffer.from(result.data, "base64"));
        }
      };
    }
    let ui = await popup();
    await poll(() => ui.evaluate('!document.querySelector("#btn-capture").disabled'), "Capture disabled");
    await ui.click("#btn-capture");
    await poll(async () => /captured/i.test(await ui.text("#message")), "Capture did not succeed");
    const key = `page:${url}`;
    const original = await worker.evaluate(key => chrome.storage.local.get(key), key);
    assert.ok(original[key].baseline.screenshot.startsWith("data:image/png;base64,"));
    assert.deepEqual(original[key].baseline.robots, ["index", "googlebot: nofollow"]);
    assert.deepEqual(original[key].baseline.metaDescriptions, ["One", "Two"]);
    assert.equal(await ui.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await ui.screenshot("01-baseline.png");
    await ui.close();
    ui = await popup();
    await poll(() => ui.evaluate('!document.querySelector("#btn-compare").disabled'), "Baseline not retained");
    await ui.click("#btn-compare");
    await poll(async () => /No observed|0 .*change/i.test(await ui.text("#change-summary")), "Unchanged page must produce zero changes");
    assert.equal(await ui.evaluate('document.querySelectorAll("#screenshots img[src]").length'), 2);
    await ui.screenshot("02-unchanged.png");
    await ui.close();
    modified = true;
    await page.reload();
    ui = await popup();
    await poll(() => ui.evaluate('!document.querySelector("#btn-compare").disabled'), "Compare disabled");
    await ui.click("#btn-compare");
    await poll(async () => /After title/.test(await ui.text("#diff-output")), "Modified values missing");
    const record = (await worker.evaluate(key => chrome.storage.local.get(key), key))[key];
    assert.deepEqual(record.baseline, original[key].baseline);
    assert.equal(record.current.title, "After title");
    assert.ok(record.current.screenshot);
    assert.match(await ui.text("#diff-output"), /internal/);
    assert.match(await ui.text("#diff-output"), /noindex/);
    await ui.screenshot("03-comparison.png");
    await ui.evaluate("window.scrollTo(0,document.body.scrollHeight)");
    await ui.screenshot("03-comparison-screenshots.png");
    await ui.close();
    ui = await popup();
    await poll(async () => /After title/.test(await ui.text("#diff-output")), "Comparison must survive reopening");
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    const exportResult = await ui.evaluate(`chrome.runtime.sendMessage({type:"EXPORT_REPORT",tabId:${tabId},expectedUrl:${JSON.stringify(url)}})`);
    assert.equal(exportResult.ok, true);
    assert.match(exportResult.reportHtml, /After title/);
    assert.match(exportResult.reportHtml, /noindex/);
    assert.equal((exportResult.reportHtml.match(/<img src=/g) || []).length, 2);
    const reportPath = path.join(evidence, "comparison-report.html");
    fs.writeFileSync(reportPath, exportResult.reportHtml);
    // Exercise the actual download button, not only the report generator.
    const downloadPath = fs.mkdtempSync(path.join(evidence, "downloads-"));
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath, eventsEnabled: true });
    await ui.click("#btn-export");
    await poll(() => fs.readdirSync(downloadPath).some(name => name.endsWith(".html")), "Export button did not download a report");
    await poll(() => ui.evaluate('!document.querySelector("#btn-capture").disabled'), "Export did not finish");
    await ui.click("#btn-capture");
    await poll(() => ui.evaluate('!document.querySelector("#replace-confirm").classList.contains("hidden")'), "Replacement confirmation missing");
    await poll(() => ui.evaluate('!document.querySelector("#btn-replace-no").disabled'), "Confirmation busy");
    await ui.click("#btn-replace-no");
    assert.deepEqual((await worker.evaluate(key => chrome.storage.local.get(key), key))[key].baseline, original[key].baseline);
    await ui.click("#btn-capture");
    await poll(() => ui.evaluate('!document.querySelector("#replace-confirm").classList.contains("hidden") && !document.querySelector("#btn-replace-yes").disabled'), "Replacement confirmation not ready");
    await ui.click("#btn-replace-yes");
    await poll(async () => {
      const item = (await worker.evaluate(key => chrome.storage.local.get(key), key))[key];
      return item.baseline.title === "After title" && item.current === null;
    }, "Confirmed replacement failed");
    await ui.click("#btn-delete");
    await poll(async () => !(await worker.evaluate(key => chrome.storage.local.get(key), key))[key], "Deletion failed");
    await ui.close();
    const reportPage = await context.newPage();
    await reportPage.goto(`file://${reportPath}`);
    assert.match(await reportPage.locator("body").innerText(), /After title/);
    assert.equal(await reportPage.locator("img").evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0)), true);
    await reportPage.screenshot({ path: path.join(evidence, "04-export.png"), fullPage: true });
    await reportPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await reportPage.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await reportPage.screenshot({ path: path.join(evidence, "05-export-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
