import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const publicFiles = [
  "index.html",
  "privacy.html",
  "sources.html",
  "privacy.css",
  "app.js",
  "styles.css",
  "market-data.js",
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

const runtimeConfig = {
  molitApiKey: String(process.env.MOLIT_API_KEY || "").trim()
};
fs.writeFileSync(
  path.join(output, "runtime-config.js"),
  `globalThis.__TOJI_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig)});\n`,
  {encoding: "utf8", mode: 0o644}
);

console.log(`GitHub Pages artifact created: ${publicFiles.length + 1} files`);
