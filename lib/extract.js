(function () {
  // Self-contained: Chrome serializes this function into the active page.
  function extractSeoSnapshot(doc = globalThis.document) {
    const page = new URL(doc.URL || doc.location.href);
    page.hash = "";
    const base = doc.baseURI || page.href;
    const privateHost = hostname => {
      const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::" ||
          /^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
      const parts = host.split(".").map(Number);
      if (parts.length !== 4 || parts.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
      return parts[0] === 127 || parts[0] === 10 || parts[0] === 0 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 169 && parts[1] === 254);
    };
    const descriptions = [];
    const robots = [];
    for (const node of doc.querySelectorAll("meta[name]")) {
      const name = (node.getAttribute("name") || "").toLowerCase();
      const content = node.getAttribute("content") || "";
      if (name === "description") descriptions.push(content);
      if (name === "robots") robots.push(content);
      if (name === "googlebot") robots.push(`googlebot: ${content}`);
    }
    const canonicals = [];
    for (const node of doc.querySelectorAll("link[rel]")) {
      if (!(node.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("canonical")) continue;
      const href = node.getAttribute("href");
      if (!href) { canonicals.push(href || ""); continue; }
      try { canonicals.push(new URL(href, base).href); } catch { canonicals.push(href); }
    }
    const internal = new Set(), external = new Set(), suspicious = new Set();
    for (const node of doc.querySelectorAll("a[href]")) {
      const href = node.getAttribute("href");
      if (!href) continue;
      try {
        const url = new URL(href, base);
        if (!["http:", "https:"].includes(url.protocol)) continue;
        (url.origin === page.origin ? internal : external).add(url.href);
        if (privateHost(url.hostname)) suspicious.add(url.href);
      } catch {}
    }
    return {
      url: page.href, timestamp: new Date().toISOString(), title: doc.title || "",
      metaDescriptions: descriptions, canonicals, robots,
      headings: Array.from(doc.querySelectorAll("h1, h2, h3"), h => ({
        level: Number(h.tagName.slice(1)), text: h.textContent.trim()
      })),
      anchors: { internal: [...internal].sort(), external: [...external].sort(), suspicious: [...suspicious].sort() },
      screenshot: null, screenshotLabel: "viewport-only"
    };
  }
  const api = { extractSeoSnapshot };
  globalThis.SeoGuardExtract = api;
  if (typeof module !== "undefined") module.exports = api;
})();
