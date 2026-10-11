import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const eumLandUseUrl = "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp";
const allowedVWorldServices = new Set(["search", "data", "address", "wms"]);
const allowedNedOperations = new Set([
  "getBuildingUse",
  "ladfrlList",
  "getPossessionAttr",
  "getLandMoveAttr",
  "getLandCharacteristics",
  "getIndvdLandPriceAttr",
  "getLandUseAttr"
]);
const deniedFiles = new Set(["/config.local.js", "/config.example.js", "/.gitignore"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function readLocalConfig() {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "config.local.js"), "utf8");
  } catch {
    // 배포 환경에서는 파일 대신 환경변수를 사용한다.
  }
  const vworldApiKey = process.env.VWORLD_API_KEY || text.match(/vworldApiKey:\s*"([^"]+)"/)?.[1] || "";
  const vworldDomain = process.env.VWORLD_DOMAIN || text.match(/vworldDomain:\s*"([^"]+)"/)?.[1] || "localhost";
  if (!vworldApiKey || vworldApiKey === "YOUR_VWORLD_API_KEY") throw new Error("VWorld API key is not configured");
  return {vworldApiKey, vworldDomain};
}

async function proxyVWorld(request, response, service, incomingUrl) {
  if (!allowedVWorldServices.has(service)) {
    response.writeHead(404, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "Unsupported VWorld service"}));
    return;
  }
  try {
    const {vworldApiKey, vworldDomain} = readLocalConfig();
    const target = new URL(`https://api.vworld.kr/req/${service}`);
    incomingUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
    target.searchParams.set("key", vworldApiKey);
    target.searchParams.set("domain", vworldDomain);
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        "Accept": request.headers.accept || "*/*",
        "Referer": request.headers.referer || `https://${vworldDomain}/`,
        "User-Agent": "Tojihannun/1.0"
      }
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": service === "wms" ? "public, max-age=300" : "no-store"
    };
    response.writeHead(upstream.status, headers);
    response.end(body);
  } catch (error) {
    console.error(`VWorld ${service} proxy failed:`, error.message);
    response.writeHead(502, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "VWorld 연결에 실패했습니다."}));
  }
}

async function proxyVWorldNed(request, response, operation, incomingUrl) {
  if (!allowedNedOperations.has(operation)) {
    response.writeHead(404, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "Unsupported VWorld NED operation"}));
    return;
  }
  try {
    const {vworldApiKey, vworldDomain} = readLocalConfig();
    const target = new URL(`https://api.vworld.kr/ned/data/${operation}`);
    incomingUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
    target.searchParams.set("key", vworldApiKey);
    target.searchParams.set("domain", vworldDomain);
    target.searchParams.set("format", "json");
    const upstream = await fetch(target, {
      headers: {
        "Accept": "application/json",
        "Referer": request.headers.referer || `https://${vworldDomain}/`,
        "User-Agent": "Tojihannun/1.0"
      }
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=300"
    });
    response.end(body);
  } catch (error) {
    console.error(`VWorld NED ${operation} proxy failed:`, error.message);
    response.writeHead(502, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "VWorld 토지·건축물 정보 연결에 실패했습니다."}));
  }
}

function buildEumLandUseParams(pnu) {
  const mainNumber = String(Number(pnu.slice(11, 15)));
  const subNumber = String(Number(pnu.slice(15, 19)));
  return new URLSearchParams({
    selGbn: "umd",
    isNoScr: "script",
    s_type: "1",
    viewType: "",
    p_location: "",
    p_type: "",
    p_type1: "",
    p_type2: "",
    p_type3: "",
    p_type4: "",
    p_type5: "",
    p_type6: "",
    p_type7: "",
    mode: "search",
    sggcd: "",
    pnu,
    ucodes: "",
    markUcodes: "",
    adzoom: "",
    scale: "",
    scaleFlag: "",
    hash: "",
    mobile_yn: "",
    add: "land",
    selSido: pnu.slice(0, 2),
    selSgg: pnu.slice(2, 5),
    selUmd: pnu.slice(4, 8),
    selRi: pnu.slice(8, 10),
    landGbn: pnu.slice(10, 11),
    bobn: mainNumber,
    bubn: subNumber
  });
}

async function proxyEumLandUse(response, incomingUrl) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  if (!/^\d{19}$/.test(pnu)) {
    response.writeHead(400, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "19자리 PNU가 필요합니다."}));
    return;
  }
  try {
    const upstream = await fetch(eumLandUseUrl, {
      method: "POST",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.eum.go.kr",
        "Referer": "https://www.eum.go.kr/web/am/amMain.jsp",
        "User-Agent": "Mozilla/5.0 (compatible; Tojihannun/1.0)"
      },
      body: buildEumLandUseParams(pnu),
      signal: AbortSignal.timeout(20000)
    });
    const html = new TextDecoder("euc-kr").decode(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(html);
  } catch (error) {
    console.error("토지이음 토지이용계획 연결 실패:", error.message);
    response.writeHead(502, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: "토지이음 연결에 실패했습니다."}));
  }
}

function serveStatic(response, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  if (deniedFiles.has(requestPath) || requestPath.startsWith("/.")) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const filePath = path.resolve(root, `.${decodeURIComponent(requestPath)}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": requestPath.startsWith("/node_modules/") ? "public, max-age=86400" : "no-cache"
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const incomingUrl = new URL(request.url || "/", `http://${request.headers.host || `localhost:${port}`}`);
  if (incomingUrl.pathname === "/api/eum/land-use") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {"Allow": "GET, HEAD"});
      response.end("Method not allowed");
      return;
    }
    await proxyEumLandUse(response, incomingUrl);
    return;
  }
  const nedMatch = incomingUrl.pathname.match(/^\/api\/vworld\/ned\/([A-Za-z]+)$/);
  if (nedMatch) {
    await proxyVWorldNed(request, response, nedMatch[1], incomingUrl);
    return;
  }
  const match = incomingUrl.pathname.match(/^\/api\/vworld\/([a-z]+)$/);
  if (match) {
    await proxyVWorld(request, response, match[1], incomingUrl);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {"Allow": "GET, HEAD"});
    response.end("Method not allowed");
    return;
  }
  serveStatic(response, incomingUrl.pathname);
});

server.listen(port, () => {
  console.log(`토지한눈: http://localhost:${port}`);
});
