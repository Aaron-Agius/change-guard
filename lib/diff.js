function compareLists(before, after, levelFor) {
  const changes = [];
  const length = Math.max(before.length, after.length);

  for (let index = 0; index < length; index += 1) {
    const beforeValue = before[index] ?? null;
    const afterValue = after[index] ?? null;
    if (beforeValue === afterValue) continue;

    changes.push({
      index,
      level: levelFor ? levelFor(index, beforeValue, afterValue) : undefined,
      before: beforeValue,
      after: afterValue,
      type: beforeValue === null ? 'added' : afterValue === null ? 'removed' : 'changed',
    });
  }

  return changes;
}

function normalizeUrl(value) {
  if (!value) return '';
  const parsed = new URL(value);
  parsed.hash = '';
  return parsed.href;
}

function diffSnapshots(baseline, current) {
  const titleBefore = baseline.title ?? null;
  const titleAfter = current.title ?? null;
  const titleChanged = titleBefore !== titleAfter;

  const metaDescriptions = compareLists(baseline.metaDescriptions || [], current.metaDescriptions || []);
  const canonicals = compareLists(baseline.canonicals || [], current.canonicals || []);
  const robots = compareLists(baseline.robots || [], current.robots || []);

  const beforeHeadings = baseline.headings || [];
  const afterHeadings = current.headings || [];
  const headings = compareLists(
    beforeHeadings.map((heading) => heading.text),
    afterHeadings.map((heading) => heading.text),
    (index, beforeValue, afterValue) => (
      afterValue === null ? beforeHeadings[index].level : afterHeadings[index].level
    ),
  );

  const internalLinksRemoved = (baseline.anchors?.internal || []).filter(
    (href) => !(current.anchors?.internal || []).includes(href),
  );
  const externalLinksAdded = (current.anchors?.external || []).filter(
    (href) => !(baseline.anchors?.external || []).includes(href),
  );
  const externalLinksRemoved = (baseline.anchors?.external || []).filter(
    (href) => !(current.anchors?.external || []).includes(href),
  );

  const suspiciousLinks = [];
  for (const href of [
    ...(current.anchors?.suspicious || []),
    ...(baseline.anchors?.suspicious || []),
  ]) {
    if (!suspiciousLinks.includes(href)) suspiciousLinks.push(href);
  }

  const changes = {
    title: titleChanged ? { before: titleBefore, after: titleAfter } : null,
    metaDescriptions,
    canonicals,
    robots,
    headings,
    internalLinksRemoved,
    externalLinksAdded,
    externalLinksRemoved,
    suspiciousLinks,
  };

  const changeCount = Number(titleChanged)
    + metaDescriptions.length
    + canonicals.length
    + robots.length
    + headings.length
    + internalLinksRemoved.length
    + externalLinksAdded.length
    + externalLinksRemoved.length
    + suspiciousLinks.length;

  return {
    url: current.url || baseline.url || '',
    urlMatch: normalizeUrl(baseline.url || '') === normalizeUrl(current.url || ''),
    changes,
    changeCount,
    baselineTimestamp: baseline.timestamp ?? null,
    currentTimestamp: current.timestamp ?? null,
  };
}

module.exports = {
  diffSnapshots,
  normalizeUrl,
};
