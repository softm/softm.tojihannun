const params = new URLSearchParams(window.location.search);
const mgmBldrgstPk = params.get("mgmBldrgstPk") || "";
const regstrKindCd = params.get("regstrKindCd") || "";
const pnuCode = params.get("pnuCode") || "";
const frame = document.querySelector("#ledgerFrame");
const status = document.querySelector("#viewerStatus");
const error = document.querySelector("#viewerError");

const isValid = /^\d{1,20}$/.test(mgmBldrgstPk) && /^\d{1,2}$/.test(regstrKindCd) && /^\d{19}$/.test(pnuCode);
const externalUrl = new URL("https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsBildRegstrInfoPreview.do");
externalUrl.search = new URLSearchParams({mgmBldrgstPk, regstrKindCd, pnuCode}).toString();

document.querySelector("#externalLink").href = externalUrl;
document.querySelector("#errorExternalLink").href = externalUrl;
document.querySelector("#closeViewer").addEventListener("click", () => {
  window.close();
  window.setTimeout(() => {
    if (!window.closed) window.location.href = "./";
  }, 100);
});

if (!isValid) {
  status.hidden = true;
  frame.hidden = true;
  error.hidden = false;
} else {
  frame.addEventListener("load", () => {
    status.hidden = true;
  }, {once: true});
  frame.src = externalUrl;
}
