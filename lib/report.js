(function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function buildReportHtml(baseline, current, report) {
    const esc = escapeHtml;
    const describe = value => typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "(absent)");
    const image = (snapshot, label) => {
      const src = snapshot?.screenshot;
      return `<figure><figcaption>${esc(label)} (viewport-only)</figcaption>${
        typeof src === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)
          ? `<img src="${src}" alt="${esc(label)} viewport screenshot">`
          : "<p>Screenshot unavailable.</p>"
      }</figure>`;
    };
    const rows = [];
    if (report) {
      for (const [key, changes] of Object.entries(report.changes)) {
        if (key === "suspiciousLinks" || !changes) continue;
        for (const item of Array.isArray(changes) ? changes : [changes]) {
          const entry = typeof item === "string"
            ? { before: key.endsWith("Added") ? null : item, after: key.endsWith("Added") ? item : null }
            : item;
          rows.push(`<tr><th>${esc(key)}</th><td>${esc(describe(entry.before))}</td><td>${esc(describe(entry.after))}</td></tr>`);
        }
      }
    }
    const snapshotRows = snapshot => Object.entries({
      title: snapshot.title, metaDescriptions: snapshot.metaDescriptions,
      canonicals: snapshot.canonicals, robots: snapshot.robots, headings: snapshot.headings,
      internalLinks: snapshot.anchors.internal, externalLinks: snapshot.anchors.external
    }).map(([name, value]) => `<tr><th>${esc(name)}</th><td><pre>${esc(JSON.stringify(value, null, 2))}</pre></td></tr>`).join("");
    const warnings = report?.warnings || baseline.warnings || [];
    const suspicious = report?.changes.suspiciousLinks || baseline.anchors.suspicious || [];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SEO Change Guard ${report ? "Comparison" : "Baseline"} Report</title>
<style>body{font:15px Georgia,serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#182524}
table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ccd6d3;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#edf3f0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;margin:0}.images{display:flex;gap:20px}figure{flex:1;min-width:0;margin:12px 0}img{width:100%}figcaption{font-weight:bold;margin-bottom:8px}.warning{background:#fff4d6;padding:12px}p{overflow-wrap:anywhere}@media(max-width:600px){.images{display:block}}</style></head><body>
<h1>SEO Change Guard ${report ? "Comparison" : "Baseline"} Report</h1>
<p>Baseline URL: ${esc(baseline.url)}<br>Captured: ${esc(baseline.timestamp)}</p>
${current ? `<p>Current URL: ${esc(current.url)}<br>Captured: ${esc(current.timestamp)}</p>` : ""}
<p>Rendered DOM and visible viewport only. Not a crawl, HTTP-header check, indexability assessment, ranking prediction or full-site certification. Saved data and screenshots may contain sensitive information.</p>
${warnings.map(w => `<p class="warning">${esc(w)}</p>`).join("")}
${report ? `<h2>${report.changeCount} observed change${report.changeCount === 1 ? "" : "s"}</h2>
${rows.length ? `<table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "<p>No observed SEO changes.</p>"}` : ""}
${suspicious.length ? `<h2>Private-address links to review (not change counts)</h2><ul>${suspicious.map(u => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
<div class="images">${image(baseline, "Baseline")}${current ? image(current, "Current") : ""}</div>
<details><summary>Baseline captured values</summary><table>${snapshotRows(baseline)}</table></details>
${current ? `<details><summary>Current captured values</summary><table>${snapshotRows(current)}</table></details>` : ""}
</body></html>`;
  }
  const api = { escapeHtml, buildReportHtml };
  globalThis.SeoGuardReport = api;
  if (typeof module !== "undefined") module.exports = api;
})();
