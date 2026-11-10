import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const publicFiles = [
  "transaction-ui.js",
  "transaction-ui.css",
  "districts-core.js",
  "districts.js",
  "districts.css",
  "index.html",
  "data-status.html",
  "data-status.js",
  "data-status.css",
  "static-transactions.js",
  "privacy.html",
  "sources.html",
  "privacy.css",
  "app.js",
  "styles.css",
  "market-data.js",
  "rtms-verified-snapshots.json",
  "market-data.css",
  "building-ledger.html",
  "building-ledger.js",
  "building-ledger.css",
  "report-export.js",
  "adfit-config.js",
  "adfit.js",
  "CNAME",
  "app-ads.txt",
  "robots.txt",
  "sitemap.xml",
  "google3963d25075aa9810.html"
];

fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output, {recursive: true});

for (const relativePath of publicFiles) {
  const source = path.join(root, relativePath);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(output, relativePath));
}

const manifestSource = path.join(root, "data/transactions/status-manifest.json");
if (!fs.existsSync(manifestSource)) throw new Error("Required data-status manifest is missing");
const manifestTarget = path.join(output, "data/transactions/status-manifest.json");
fs.mkdirSync(path.dirname(manifestTarget), {recursive: true});
fs.copyFileSync(manifestSource, manifestTarget);
const registrySource = path.join(root, "data/transactions/storage-registry.json");
if (fs.existsSync(registrySource)) fs.copyFileSync(registrySource, path.join(output, "data/transactions/storage-registry.json"));

for (const name of ["published", "status"]) {
  const directory = path.join(root, "data/transactions", name);
  if (fs.existsSync(directory)) fs.cpSync(directory, path.join(output, "data/transactions", name), {recursive: true});
}
// Raw inputs, worker state, credentials and inbox are deliberately NOT published.
const runtimeConfig = {
  molitApiKey: String(process.env.MOLIT_API_KEY || "").trim(),
  parcelHistoryEndpoint: String(process.env.PARCEL_HISTORY_ENDPOINT || "").trim()
};
fs.writeFileSync(
  path.join(output, "runtime-config.js"),
  `globalThis.__TOJI_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig)});\n`,
  {encoding: "utf8", mode: 0o644}
);

console.log(`GitHub Pages artifact created: ${publicFiles.length + 1} files`);
