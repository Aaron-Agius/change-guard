const fs = require("node:fs");
const path = require("node:path");
const { zipSync, unzipSync } = require("fflate");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))).version;
const output = path.join(root, "dist");
fs.mkdirSync(output, { recursive: true });
const stage = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "change-guard-package-"));
try {
  const folder = path.join(stage, "seo-change-guard");
  fs.mkdirSync(folder);
  for (const name of ["manifest.json", "background", "src", "lib", "icons", "README.md", "LICENSE", "CHANGELOG.md"]) {
    fs.cpSync(path.join(root, name), path.join(folder, name), { recursive: true });
  }
  const zip = path.join(output, `seo-change-guard-${version}.zip`);
  const entries = {};
  function collect(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) collect(file);
      else entries[path.relative(stage, file).split(path.sep).join("/")] = fs.readFileSync(file);
    }
  }
  collect(folder);
  const archive = zipSync(entries, { level: 9 });
  const restored = unzipSync(archive);
  for (const [name, bytes] of Object.entries(entries)) {
    if (!Buffer.from(restored[name]).equals(bytes)) throw new Error(`ZIP validation failed: ${name}`);
  }
  fs.writeFileSync(zip, archive);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  fs.writeFileSync(`${zip}.sha256`, `${digest}  ${path.basename(zip)}\n`);
  console.log(`${zip}\nSHA256 ${digest}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
