(function () {
  function diffSnapshots(baseline, current) {
    const changes = {};
    changes.title = baseline.title === current.title ? null : { before: baseline.title, after: current.title };
    const pairs = (before = [], after = []) => {
      const result = [];
      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        const b = before[i] ?? null, a = after[i] ?? null;
        if (JSON.stringify(b) !== JSON.stringify(a)) result.push({
          index: i, before: b, after: a, type: b === null ? "added" : a === null ? "removed" : "changed"
        });
      }
      return result;
    };
    for (const key of ["metaDescriptions", "canonicals", "robots"]) changes[key] = pairs(baseline[key], current[key]);
    const headings = list => (list || []).map(h => `${h.level}: ${h.text}`);
    changes.headings = pairs(headings(baseline.headings), headings(current.headings));
    changes.internalLinksRemoved = baseline.anchors.internal.filter(u => !current.anchors.internal.includes(u));
    changes.externalLinksAdded = current.anchors.external.filter(u => !baseline.anchors.external.includes(u));
    changes.externalLinksRemoved = baseline.anchors.external.filter(u => !current.anchors.external.includes(u));
    changes.suspiciousLinks = [...new Set(current.anchors.suspicious)];
    const changeCount = Number(!!changes.title) + ["metaDescriptions", "canonicals", "robots", "headings",
      "internalLinksRemoved", "externalLinksAdded", "externalLinksRemoved"].reduce((n, key) => n + changes[key].length, 0);
    const normalize = value => { const url = new URL(value); url.hash = ""; return url.href; };
    return {
      url: current.url, baselineUrl: baseline.url, urlMatch: normalize(baseline.url) === normalize(current.url),
      changeCount, changes, warnings: [],
      baselineTimestamp: baseline.timestamp, currentTimestamp: current.timestamp,
      baselineScreenshot: baseline.screenshot, currentScreenshot: current.screenshot
    };
  }
  const api = { diffSnapshots };
  globalThis.SeoGuardDiff = api;
  if (typeof module !== "undefined") module.exports = api;
})();
