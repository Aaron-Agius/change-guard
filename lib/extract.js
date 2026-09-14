function normalizeUrl(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  return parsed.href;
}

function isSuspiciousHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [, first, second] = ipv4.map(Number);
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;

  return false;
}

function collectUrls(anchor, baseUrl, buckets) {
  const href = anchor.getAttribute('href');
  if (!href) return;

  let resolved;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return;
  }

  if (['javascript:', 'mailto:', 'tel:', 'data:', 'blob:'].includes(resolved.protocol)) {
    return;
  }

  const hrefValue = resolved.href;
  const target = isSuspiciousHost(resolved.hostname)
    ? 'suspicious'
    : resolved.origin === baseUrl.origin
      ? 'internal'
      : 'external';

  if (!buckets[target].includes(hrefValue)) {
    buckets[target].push(hrefValue);
  }
}

function extractSeoSnapshot(document) {
  const baseUrl = new URL(document.baseURI || document.URL);
  const titles = document.querySelectorAll('title');
  const descriptionNodes = document.querySelectorAll('meta[name="description"]');
  const canonicalNodes = document.querySelectorAll('link[rel="canonical"]');
  const robotNodes = document.querySelectorAll('meta[name="robots"]');
  const headingNodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const anchorNodes = document.querySelectorAll('a');

  const buckets = { internal: [], external: [], suspicious: [] };
  for (const anchor of anchorNodes) {
    collectUrls(anchor, baseUrl, buckets);
  }

  return {
    url: normalizeUrl(document.URL),
    timestamp: new Date().toISOString(),
    title: titles[0] ? titles[0].textContent.trim() : '',
    metaDescriptions: [...descriptionNodes].map((node) => node.getAttribute('content') ?? ''),
    canonicals: [...canonicalNodes].map((node) => node.getAttribute('href') ?? ''),
    robots: [...robotNodes].map((node) => node.getAttribute('content') ?? ''),
    headings: [...headingNodes].map((node) => ({
      level: Number(node.tagName.slice(1)),
      text: node.textContent.trim(),
    })),
    anchors: buckets,
    screenshot: null,
    screenshotLabel: null,
  };
}

module.exports = {
  extractSeoSnapshot,
  isSuspiciousHost,
  normalizeUrl,
};
