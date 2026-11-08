// Deterministic, idempotent integration. Does not touch unrelated file content.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
export function patchFile(name, original) {
  let text = original;
  const insert = (anchor, replacement) => {
    if (!text.includes(anchor)) throw new Error(`${name}: integration anchor not found`);
    text = text.replace(anchor, replacement);
  };
  if (name === "index.html") {
    if (!text.includes('href="./districts.css')) insert("</head>", '  <link rel="stylesheet" href="./districts.css?v=20261108.1" />\n  </head>');
    if (!text.includes('src="./districts-core.js')) insert("</body>", '  <script defer src="./districts-core.js?v=20261108.1"></script>\n    <script defer src="./districts.js?v=20261108.1"></script>\n  </body>');
  } else if (name === "app.js") {
    if (!text.includes("TojiDistricts?.handleMapClick")) insert('async function handleMapClick(event) {', 'async function handleMapClick(event) {\n  if (window.TojiDistricts?.handleMapClick(event)) return;');
    if (!text.includes("TojiDistricts?.attach")) insert('map.on("singleclick", handleMapClick);', 'map.on("singleclick", handleMapClick);\n  window.TojiDistricts?.attach(map, {key: VWORLD_BROWSER_KEY, useJsonp: USE_VWORLD_JSONP, getParcel: () => state.records.find(item => item.id === state.selectedId)});');
  } else if (name === "server.mjs") {
    if (!text.includes('"getCtySpceWFS"')) insert('const allowedNedOperations = new Set([', 'const allowedNedOperations = new Set([\n  "getCtySpceWFS",');
    if (!text.includes('operation === "getCtySpceWFS" ? "wfs"')) insert('const target = new URL(`https://api.vworld.kr/ned/data/${operation}`);', 'const family = operation === "getCtySpceWFS" ? "wfs" : "data";\n    const target = new URL(`https://api.vworld.kr/ned/${family}/${operation}`);');
  } else if (name === "districts.js") {
    if (!text.includes("document.body.append(wrap)")) insert("wrap.append(panel); host.append(wrap);", "wrap.append(panel); document.body.append(wrap);");
  } else if (name === "scripts/build-pages.mjs") {
    if (!text.includes('"districts-core.js"')) insert('const publicFiles = [', 'const publicFiles = [\n  "districts-core.js",\n  "districts.js",\n  "districts.css",');
  }
  return text;
}
export function install(root) {
  const changed = [];
  for (const name of ["index.html", "app.js", "server.mjs", "scripts/build-pages.mjs", "districts.js"]) {
    const file = path.join(root, name), original = fs.readFileSync(file, "utf8"), patched = patchFile(name, original);
    if (patched !== original) {fs.writeFileSync(file, patched); changed.push(name);}
  }
  return changed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--write")) throw new Error("Explicit --write is required.");
  console.log("District integration:", install(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")).join(", ") || "already installed");
}
