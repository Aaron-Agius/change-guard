const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSeoSnapshot } = require('../lib/extract');

function node(tagName, attributes = {}, textContent = '') {
  return {
    tagName: tagName.toUpperCase(),
    textContent,
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
  };
}

function anchor(href) {
  return node('a', href ? { href } : {});
}

function fakeDocument({
  url = 'https://example.test/page',
  baseURI = url,
  selectors = {},
} = {}) {
  const empty = [];
  return {
    URL: url,
    baseURI,
    querySelectorAll(selector) {
      return Object.hasOwn(selectors, selector) ? selectors[selector] : empty;
    },
  };
}

function makeSnapshot(options) {
  return extractSeoSnapshot(fakeDocument(options));
}

test('extracts a normal snapshot', () => {
  const snapshot = makeSnapshot({
    selectors: {
      'title': [node('title', {}, 'Normal Page')],
      'meta[name="description"]': [node('meta', { content: 'Description' })],
      'link[rel="canonical"]': [node('link', { href: 'https://example.test/canonical' })],
      'meta[name="robots"]': [node('meta', { content: 'noindex, nofollow' })],
      'h1, h2, h3, h4, h5, h6': [node('h1', {}, 'Main'), node('h2', {}, 'Sub')],
      'a': [
        anchor('https://example.test/internal'),
        anchor('https://external.test/page'),
      ],
    },
  });

  assert.equal(snapshot.title, 'Normal Page');
  assert.deepEqual(snapshot.metaDescriptions, ['Description']);
  assert.deepEqual(snapshot.canonicals, ['https://example.test/canonical']);
  assert.deepEqual(snapshot.robots, ['noindex, nofollow']);
  assert.deepEqual(snapshot.headings, [
    { level: 1, text: 'Main' },
    { level: 2, text: 'Sub' },
  ]);
  assert.deepEqual(snapshot.anchors, {
    internal: ['https://example.test/internal'],
    external: ['https://external.test/page'],
    suspicious: [],
  });
  assert.equal(typeof snapshot.timestamp, 'string');
});

test('preserves duplicate descriptions and canonicals and de-duplicates links', () => {
  const snapshot = makeSnapshot({
    selectors: {
      'meta[name="description"]': [
        node('meta', { content: 'same' }),
        node('meta', { content: 'same' }),
      ],
      'link[rel="canonical"]': [
        node('link', { href: 'https://example.test/a' }),
        node('link', { href: 'https://example.test/a' }),
      ],
      'a': [
        anchor('https://example.test/twice'),
        anchor('https://example.test/twice'),
      ],
    },
  });

  assert.deepEqual(snapshot.metaDescriptions, ['same', 'same']);
  assert.deepEqual(snapshot.canonicals, ['https://example.test/a', 'https://example.test/a']);
  assert.deepEqual(snapshot.anchors.internal, ['https://example.test/twice']);
});

test('resolves relative links against document.baseURI', () => {
  const snapshot = makeSnapshot({
    url: 'https://example.test/articles/current',
    baseURI: 'https://example.test/articles/base/index.html',
    selectors: {
      'a': [
        anchor('/root'),
        anchor('../parent'),
        anchor('child'),
        anchor('//cdn.example.test/asset'),
      ],
    },
  });

  assert.deepEqual(snapshot.anchors, {
    internal: [
      'https://example.test/root',
      'https://example.test/articles/parent',
      'https://example.test/articles/base/child',
    ],
    external: ['https://cdn.example.test/asset'],
    suspicious: [],
  });
});

test('keeps hostile strings as data and ignores non-navigation schemes', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const snapshot = makeSnapshot({
    selectors: {
      'title': [node('title', {}, hostile)],
      'h1, h2, h3, h4, h5, h6': [node('h1', {}, hostile)],
      'a': [
        anchor('javascript:alert(1)'),
        anchor('mailto:user@example.test'),
        anchor('tel:+15555555555'),
        anchor('data:text/html,<script>alert(1)</script>'),
        anchor('blob:https://example.test/id'),
      ],
    },
  });

  assert.equal(snapshot.title, hostile);
  assert.deepEqual(snapshot.headings, [{ level: 1, text: hostile }]);
  assert.deepEqual(snapshot.anchors, { internal: [], external: [], suspicious: [] });
});

test('handles missing SEO tags and removes URL fragments', () => {
  const snapshot = makeSnapshot({ url: 'https://example.test/page#fragment' });

  assert.equal(snapshot.url, 'https://example.test/page');
  assert.equal(snapshot.title, '');
  assert.deepEqual(snapshot.metaDescriptions, []);
  assert.deepEqual(snapshot.canonicals, []);
  assert.deepEqual(snapshot.robots, []);
  assert.deepEqual(snapshot.headings, []);
  assert.deepEqual(snapshot.anchors, { internal: [], external: [], suspicious: [] });
});

test('classifies private, loopback, and localhost links as suspicious', () => {
  const snapshot = makeSnapshot({
    selectors: {
      'a': [
        anchor('http://localhost:3000/admin'),
        anchor('http://127.0.0.1:8080/loop'),
        anchor('http://10.1.2.3/private'),
        anchor('http://172.16.0.1/private'),
        anchor('http://172.31.255.255/private'),
        anchor('http://192.168.1.1/private'),
        anchor('http://172.32.0.1/not-private'),
      ],
    },
  });

  assert.deepEqual(snapshot.anchors.suspicious, [
    'http://localhost:3000/admin',
    'http://127.0.0.1:8080/loop',
    'http://10.1.2.3/private',
    'http://172.16.0.1/private',
    'http://172.31.255.255/private',
    'http://192.168.1.1/private',
  ]);
  assert.deepEqual(snapshot.anchors.external, ['http://172.32.0.1/not-private']);
});
