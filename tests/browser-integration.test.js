const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const FIXTURES = {
  baseline: '/fixtures/baseline-page.html',
  unchanged: '/fixtures/unchanged-page.html',
  modified: '/fixtures/modified-page.html',
};

const rootDir = path.resolve(__dirname, '..');
const CHROMIUM_EXECUTABLE = process.env.SEO_CHANGE_GUARD_CHROME_PATH;

const DRIVER_SPECIFIERS = [
  'playwright-core',
  'playwright',
  '@playwright/test',
  'puppeteer-core',
  'puppeteer',
];

function requireOptionalDriver() {
  const attempts = [];
  for (const specifier of DRIVER_SPECIFIERS) {
    try {
      const driver = require(specifier);
      return { driver, specifier };
    } catch (error) {
      attempts.push(`${specifier}: ${error.code || error.message}`);
    }
  }
  return { attempts };
}

function getBrowserType(driver, specifier) {
  if (specifier.startsWith('puppeteer')) {
    throw new Error(
      `${specifier} was detected, but this suite requires a persistent browser context; ` +
      'install playwright-core to run it.'
    );
  }
  const browserType = driver.chromium || driver.default?.chromium;
  if (!browserType) throw new Error('The detected Playwright package does not expose chromium.');
  return browserType;
}

function createFixtureServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://seo-fixture.test').pathname;
    const file = FIXTURES[pathname] || (pathname === '/content' ? currentFixturePath : null);
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('fixture not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(fs.readFileSync(path.join(rootDir, file)));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// `activeTab` requires a real user gesture that browser automation cannot create.
// Loading this temporary, fixture-host-only copy keeps production permissions
// unchanged while allowing the service-worker workflow to be tested end to end.
async function createTestExtensionCopy(rootDir, fixtureOrigin) {
  const extensionDir = path.join(rootDir, '.test-extension-copy');
  await fs.promises.rm(extensionDir, { recursive: true, force: true });
  await fs.promises.mkdir(extensionDir);
  await Promise.all([
    fs.promises.cp(path.join(rootDir, 'manifest.json'), path.join(extensionDir, 'manifest.json')),
    fs.promises.cp(path.join(rootDir, 'background'), path.join(extensionDir, 'background'), { recursive: true }),
    fs.promises.cp(path.join(rootDir, 'lib'), path.join(extensionDir, 'lib'), { recursive: true }),
    fs.promises.cp(path.join(rootDir, 'src'), path.join(extensionDir, 'src'), { recursive: true }),
    fs.promises.cp(path.join(rootDir, 'icons'), path.join(extensionDir, 'icons'), { recursive: true }),
  ]);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    fixtureOrigin,
  ])];
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionDir;
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

async function sendToBackground(worker, message) {
  return worker.evaluate((payload) => new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : response);
    });
  }), message);
}

async function getBackgroundWorker(context) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) return workers.at(-1);
    try {
      await context.waitForEvent('serviceworker', { timeout: 1000 });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Extension service worker did not start: ${lastError?.message || 'timeout'}`);
}

async function withExtensionRuntime(worker, action) {
  return worker.evaluate((actionString) => new Promise((resolve) => {
    try {
      (0, eval)(`(${actionString})((response) => resolve(response))`);
    } catch (error) {
      resolve({ harnessError: error.message });
    }
  }), action.toString());
}

async function getStoredBaselines(worker) {
  return worker.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get('baselines', (result) => resolve(result.baselines || {}));
  }));
}

async function messageWithStoredResult(worker, message) {
  const response = await sendToBackground(worker, message);
  assert.equal(response.ok, true, `background request failed: ${response.error || 'unknown error'}`);
  const baselines = await getStoredBaselines(worker);
  return { response, baselines };
}

test('captures, compares, preserves, and deletes SEO baselines in Chromium', async (t) => {
  const driverInfo = requireOptionalDriver();
  if (!driverInfo.driver) {
    t.skip(`No supported browser driver installed. Tried: ${driverInfo.attempts.join('; ')}`);
    return;
  }

  let browserType;
  try {
    browserType = getBrowserType(driverInfo.driver, driverInfo.specifier);
  } catch (error) {
    t.skip(error.message);
    return;
  }

  const { server, port } = await createFixtureServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fixtureOrigin = `${baseUrl}/`;
  let currentFixturePath = FIXTURES.baseline;
  let userDataDir;
  let context;
  const consoleErrors = [];

  t.after(async () => {
    if (context) await context.close().catch(() => {});
    if (userDataDir) await fs.promises.rm(userDataDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  });

  userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-change-guard-'));
  const extensionDir = await createTestExtensionCopy(rootDir, fixtureOrigin);
  const launchOptions = {
    headless: false,
    chromiumSandbox: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  };
  if (CHROMIUM_EXECUTABLE) launchOptions.executablePath = CHROMIUM_EXECUTABLE;
  context = await browserType.launchPersistentContext(userDataDir, launchOptions);

  for (const event of ['console', 'weberror', 'serviceworker']) {
    if (event === 'console') {
      context.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
    } else if (event === 'weberror') {
      context.on('weberror', (error) => consoleErrors.push(error.error().message));
    } else {
      context.on('serviceworker', (worker) => {
        worker.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
      });
    }
  }

  const worker = await getBackgroundWorker(context);
  const page = context.pages()[0] || await context.newPage();
  const senderId = await worker.evaluate(() => chrome.runtime.id);
  assert.ok(senderId, 'extension runtime id is unavailable');

  await page.goto(`${baseUrl}${FIXTURES.baseline}`, { waitUntil: 'load' });
  const activeTabResult = await withExtensionRuntime(
    worker,
    (done) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => done(tabs[0].id)),
  );
  assert.ok(!activeTabResult?.harnessError, activeTabResult?.harnessError);
  const activeTab = activeTabResult;
  assert.equal(typeof activeTab, 'number', 'active fixture tab was not found');
  const message = (type) => ({ type, tabId: activeTab });

  const captured = await messageWithStoredResult(worker, message('CAPTURE_BASELINE'));
  const baselineKey = normalizeUrl(page.url());
  const baseline = captured.baselines[baselineKey];
  assert.ok(baseline, 'capture did not create a baseline');
  assert.equal(baseline.title, 'SEO Baseline Fixture');
  assert.deepEqual(baseline.metaDescriptions, [
    'First baseline description',
    'Second baseline description',
  ]);
  assert.equal(baseline.canonicals[0], `${baseUrl}/canonical-page`);
  assert.equal(baseline.canonicals[1], 'https://seo-fixture.test/absolute-canonical');
  assert.deepEqual(baseline.robots, ['index, follow', 'googlebot: index, nofollow']);
  assert.deepEqual(baseline.headings, [
    { level: 1, text: 'SEO Baseline Fixture' },
    { level: 2, text: 'Internal links' },
    { level: 2, text: 'External links' },
    { level: 2, text: 'Review links' },
    { level: 2, text: 'Supporting heading' },
    { level: 3, text: 'Supporting subheading' },
  ]);
  assert.deepEqual(baseline.anchors.internal, [
    `${baseUrl}/internal-one`,
    `${baseUrl}/internal-three?query=kept`,
    `${baseUrl}/internal-two`,
    `${baseUrl}/nested/internal-four`,
    'https://seo-fixture.test/internal-five',
  ]);
  assert.deepEqual(baseline.anchors.external, [
    'https://external-one.test/page',
    'https://external-three.test/page',
    'https://external-two.test/page',
  ]);
  assert.deepEqual(baseline.anchors.suspicious, ['http://192.168.1.1/admin']);
  assert.ok(baseline.screenshot?.startsWith('data:image/png;base64,'), 'capture screenshot is missing');
  assert.equal(baseline.screenshotLabel, 'viewport-only');

  currentFixturePath = FIXTURES.unchanged;
  await page.goto(`${baseUrl}/content`, { waitUntil: 'load' });
  const unchangedCompare = await sendToBackground(worker, message('COMPARE_BASELINE'));
  assert.equal(unchangedCompare.ok, true, unchangedCompare.error);
  assert.equal(unchangedCompare.report.urlMatch, true);
  assert.equal(unchangedCompare.report.changeCount, 0);
  assert.equal(unchangedCompare.report.changes.title, null);
  assert.deepEqual(unchangedCompare.report.changes.metaDescriptions, []);
  assert.deepEqual(unchangedCompare.report.changes.canonicals, []);
  assert.deepEqual(unchangedCompare.report.changes.robots, []);
  assert.deepEqual(unchangedCompare.report.changes.headings, []);
  assert.deepEqual(unchangedCompare.report.changes.internalLinksRemoved, []);
  assert.deepEqual(unchangedCompare.report.changes.externalLinksAdded, []);
  assert.deepEqual(unchangedCompare.report.changes.externalLinksRemoved, []);

  const unchangedStored = await getStoredBaselines(worker);
  assert.equal(unchangedStored[baselineKey], baseline);

  currentFixturePath = FIXTURES.modified;
  await page.goto(`${baseUrl}/content`, { waitUntil: 'load' });
  const modifiedCompare = await sendToBackground(worker, message('COMPARE_BASELINE'));
  assert.equal(modifiedCompare.ok, true, modifiedCompare.error);
  const changes = modifiedCompare.report.changes;
  assert.deepEqual(changes.title, {
    before: 'SEO Baseline Fixture',
    after: 'SEO Modified Fixture',
  });
  assert.deepEqual(changes.canonicals, [{
    index: 0,
    level: undefined,
    before: `${baseUrl}/canonical-page`,
    after: `${baseUrl}/changed-canonical`,
    type: 'changed',
  }]);
  assert.deepEqual(changes.robots, [{
    index: 0,
    level: undefined,
    before: 'index, follow',
    after: 'noindex, follow',
    type: 'changed',
  }]);
  assert.deepEqual(changes.headings, [{
    index: 4,
    level: 2,
    before: '2: Internal links',
    after: '2: External links',
    type: 'changed',
  }]);
  assert.deepEqual(changes.internalLinksRemoved, ['https://seo-fixture.test/internal-five']);
  assert.deepEqual(changes.externalLinksAdded, ['https://external-four.test/added']);
  assert.deepEqual(changes.externalLinksRemoved, ['https://external-three.test/page']);
  assert.deepEqual(changes.suspiciousLinks, ['http://192.168.1.1/admin']);
  assert.equal(modifiedCompare.report.changeCount, 7);

  const afterModifiedCompare = await getStoredBaselines(worker);
  assert.equal(afterModifiedCompare[baselineKey], baseline, 'compare replaced the baseline');

  const deleted = await sendToBackground(worker, message('DELETE_BASELINE'));
  assert.equal(deleted.ok, true, deleted.error);
  const afterDelete = await getStoredBaselines(worker);
  assert.ok(!(baselineKey in afterDelete), 'delete did not remove the baseline');

  const baselineTab = await context.newPage();
  await baselineTab.goto(`${baseUrl}${FIXTURES.baseline}`, { waitUntil: 'load' });
  const expectedTitle = 'SEO Baseline Fixture';
  assert.equal(await baselineTab.title(), expectedTitle);

  assert.deepEqual(consoleErrors, [], `unexpected browser errors: ${consoleErrors.join(' | ')}`);
});
