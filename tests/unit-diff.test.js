const test = require('node:test');
const assert = require('node:assert/strict');

const { diffSnapshots } = require('../lib/diff');

function snapshot(overrides = {}) {
  return {
    url: 'https://example.test/page',
    timestamp: '2026-09-14T12:00:00.000Z',
    title: 'Title',
    metaDescriptions: [],
    canonicals: [],
    robots: [],
    headings: [],
    anchors: { internal: [], external: [], suspicious: [] },
    ...overrides,
  };
}

test('returns no changes for an unchanged snapshot', () => {
  const report = diffSnapshots(
    snapshot({ timestamp: '2026-09-14T12:00:00.000Z' }),
    snapshot({ timestamp: '2026-09-14T13:00:00.000Z' }),
  );

  assert.equal(report.urlMatch, true);
  assert.equal(report.changeCount, 0);
  assert.deepEqual(report.changes, {
    title: null,
    metaDescriptions: [],
    canonicals: [],
    robots: [],
    headings: [],
    internalLinksRemoved: [],
    externalLinksAdded: [],
    externalLinksRemoved: [],
    suspiciousLinks: [],
  });
});

test('reports changed title, canonical, and robots values', () => {
  const report = diffSnapshots(
    snapshot({
      canonicals: ['https://example.test/old'],
      robots: ['index, follow'],
    }),
    snapshot({
      timestamp: '2026-09-14T13:00:00.000Z',
      title: 'New Title',
      canonicals: ['https://example.test/new'],
      robots: ['noindex, follow'],
    }),
  );

  assert.deepEqual(report.changes.title, { before: 'Title', after: 'New Title' });
  assert.deepEqual(report.changes.canonicals, [{
    index: 0,
    level: undefined,
    before: 'https://example.test/old',
    after: 'https://example.test/new',
    type: 'changed',
  }]);
  assert.deepEqual(report.changes.robots, [{
    index: 0,
    level: undefined,
    before: 'index, follow',
    after: 'noindex, follow',
    type: 'changed',
  }]);
  assert.equal(report.changeCount, 3);
});

test('reports removed headings in order', () => {
  const report = diffSnapshots(
    snapshot({
      headings: [
        { level: 1, text: 'Stay' },
        { level: 2, text: 'Remove me' },
        { level: 3, text: 'Also remove me' },
      ],
    }),
    snapshot({ headings: [{ level: 1, text: 'Stay' }] }),
  );

  assert.deepEqual(report.changes.headings, [
    {
      index: 1,
      level: 2,
      before: 'Remove me',
      after: null,
      type: 'removed',
    },
    {
      index: 2,
      level: 3,
      before: 'Also remove me',
      after: null,
      type: 'removed',
    },
  ]);
  assert.equal(report.changeCount, 2);
});

test('reports internal links only when removed and external links in either direction', () => {
  const report = diffSnapshots(
    snapshot({
      anchors: {
        internal: ['https://example.test/kept', 'https://example.test/removed'],
        external: ['https://external.test/removed'],
        suspicious: [],
      },
    }),
    snapshot({
      anchors: {
        internal: ['https://example.test/kept'],
        external: ['https://external.test/added'],
        suspicious: [],
      },
    }),
  );

  assert.deepEqual(report.changes.internalLinksRemoved, ['https://example.test/removed']);
  assert.deepEqual(report.changes.externalLinksAdded, ['https://external.test/added']);
  assert.deepEqual(report.changes.externalLinksRemoved, ['https://external.test/removed']);
  assert.equal(report.changeCount, 3);
});

test('reports suspicious links from current and baseline snapshots', () => {
  const report = diffSnapshots(
    snapshot({ anchors: { internal: [], external: [], suspicious: ['http://10.0.0.1/old'] } }),
    snapshot({
      anchors: {
        internal: [],
        external: [],
        suspicious: ['http://192.168.0.2/new', 'http://10.0.0.1/old'],
      },
    }),
  );

  assert.deepEqual(report.changes.suspiciousLinks, [
    'http://192.168.0.2/new',
    'http://10.0.0.1/old',
  ]);
  assert.equal(report.changeCount, 2);
});
