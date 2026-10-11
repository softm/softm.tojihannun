(function () {
  "use strict";

  const REPORT_WIDTH = 794;
  const COLORS = {
    ink: "16241F",
    soft: "687A73",
    green: "176B54",
    pale: "EAF3EF",
    line: "D9E1DD",
    white: "FFFFFF"
  };
  const DOCX_FONT = {
    ascii: "AppleGothic",
    hAnsi: "AppleGothic",
    eastAsia: "AppleGothic",
    cs: "AppleGothic",
    hint: "eastAsia"
  };

  function escapeHtml(value) {
    return String(value ?? "-")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeValue(value) {
    const output = String(value ?? "").trim();
    return output || "-";
  }

  function fileName(model, extension) {
    const base = safeValue(model.fileBase || model.address || "토지정보")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    return `${base}_보고서.${extension}`;
  }

  function sectionTableHtml(section) {
    if (!section.rows?.length) return `<p class="download-report__empty">조회된 정보가 없습니다.</p>`;
    if (section.kind === "keyValue") {
      return `<table class="key-value"><tbody>${section.rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(safeValue(value))}</td></tr>`).join("")}</tbody></table>`;
    }
    const headers = section.headers || ["내용"];
    return `<table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(safeValue(value))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function reportHtml(model, includeClass = true) {
    return `<article${includeClass ? ' class="download-report"' : ""}>
      <p class="download-report__brand">토지한눈</p>
      <h1>${escapeHtml(model.title)}</h1>
      <p class="download-report__address">${escapeHtml(model.address)}</p>
      <div class="download-report__meta">
        <span>도로명 ${escapeHtml(safeValue(model.road))}</span>
        <span>작성일 ${escapeHtml(model.generatedAt)}</span>
        <span>PNU ${escapeHtml(safeValue(model.pnu))}</span>
      </div>
      ${model.mapImage ? `<figure class="download-report__map"><img src="${escapeHtml(model.mapImage)}" alt="${escapeHtml(model.address)} 필지 주변 지도"><figcaption>필지 주변 지도 · VWorld 배경지도 · 선택 필지 경계 강조 · 참고용</figcaption></figure>` : ""}
      ${model.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${sectionTableHtml(section)}</section>`).join("")}
      <p class="download-report__notice">${escapeHtml(model.notice)}</p>
      <footer class="download-report__footer"><span>${escapeHtml(model.source)}</span><span>토지한눈 자동 생성 보고서</span></footer>
    </article>`;
  }

  function createReportElement(model) {
    const holder = document.createElement("div");
    holder.innerHTML = reportHtml(model);
    const report = holder.firstElementChild;
    document.body.appendChild(report);
    return report;
  }

  function renderPreview(model, target) {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) return;
    element.innerHTML = reportHtml(model);
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지 파일을 만들지 못했습니다.")), mimeType, quality);
    });
  }

  async function captureReport(model) {
    if (typeof window.html2canvas !== "function") throw new Error("이미지 생성 모듈을 불러오지 못했습니다.");
    const report = createReportElement(model);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...report.querySelectorAll("img")].map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener("load", resolve, {once: true});
            image.addEventListener("error", resolve, {once: true});
          })));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return await window.html2canvas(report, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: REPORT_WIDTH,
        windowWidth: REPORT_WIDTH
      });
    } finally {
      report.remove();
    }
  }

  async function exportImage(model, format) {
    const canvas = await captureReport(model);
    const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
    const blob = await canvasToBlob(canvas, mimeType, format === "jpg" ? 0.92 : undefined);
    saveBlob(blob, fileName(model, format));
  }

  async function exportPdf(model) {
    if (!window.jspdf?.jsPDF) throw new Error("PDF 생성 모듈을 불러오지 못했습니다.");
    const canvas = await captureReport(model);
    const {jsPDF} = window.jspdf;
    const pdf = new jsPDF({orientation: "portrait", unit: "mm", format: "a4", compress: true});
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const maxSliceHeight = Math.max(1, Math.floor(canvas.width * contentHeight / contentWidth));
    let sliceHeight = maxSliceHeight;
    let pageCount = Math.ceil(canvas.height / sliceHeight);
    const lastSliceHeight = canvas.height - sliceHeight * (pageCount - 1);

    // 캔버스 높이가 A4 배수보다 몇 픽셀만 클 때 빈 페이지가 하나 더 생기지 않게
    // 전체 보고서를 기존 페이지 수에 아주 조금 축소해 나눠 담는다.
    if (pageCount > 1 && lastSliceHeight < sliceHeight * 0.08) {
      pageCount -= 1;
      sliceHeight = Math.ceil(canvas.height / pageCount);
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (pageIndex > 0) pdf.addPage();
      const sourceY = pageIndex * sliceHeight;
      const sourceHeight = Math.min(sliceHeight, canvas.height - sourceY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sourceHeight;
      const context = pageCanvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
      const imageScale = Math.min(contentWidth / canvas.width, contentHeight / sourceHeight);
      const imageWidth = canvas.width * imageScale;
      const imageHeight = sourceHeight * imageScale;
      const imageX = margin + (contentWidth - imageWidth) / 2;
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.94), "JPEG", imageX, margin, imageWidth, imageHeight, undefined, "FAST");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(110, 124, 117);
      pdf.text(`${pageIndex + 1} / ${pageCount}`, pageWidth - margin, pageHeight - 4, {align: "right"});
    }
    pdf.save(fileName(model, "pdf"));
  }

  function docxBorders(docx) {
    const border = {style: docx.BorderStyle.SINGLE, size: 1, color: COLORS.line};
    return {top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border};
  }

  function docxCell(docx, value, options = {}) {
    return new docx.TableCell({
      verticalAlign: docx.VerticalAlign.CENTER,
      shading: options.fill ? {fill: options.fill, type: docx.ShadingType.CLEAR, color: "auto"} : undefined,
      margins: {top: 130, bottom: 130, left: 150, right: 150},
      children: [new docx.Paragraph({
        alignment: options.align || docx.AlignmentType.LEFT,
        spacing: {before: 0, after: 0, line: 260},
        children: [new docx.TextRun({
          text: safeValue(value),
          bold: Boolean(options.bold),
          color: options.color || COLORS.ink,
          font: DOCX_FONT,
          size: options.size || 20
        })]
      })]
    });
  }

  function docxTable(docx, section) {
    if (!section.rows?.length) {
      return new docx.Paragraph({children: [new docx.TextRun({text: "조회된 정보가 없습니다.", color: COLORS.soft, font: DOCX_FONT, size: 20})]});
    }
    const rows = [];
    if (section.kind !== "keyValue") {
      rows.push(new docx.TableRow({
        tableHeader: true,
        children: (section.headers || ["내용"]).map((header) => docxCell(docx, header, {bold: true, fill: COLORS.green, color: COLORS.white}))
      }));
    }
    section.rows.forEach((row, index) => {
      if (section.kind === "keyValue") {
        rows.push(new docx.TableRow({children: [docxCell(docx, row[0], {bold: true, fill: COLORS.pale}), docxCell(docx, row[1])] }));
      } else {
        rows.push(new docx.TableRow({children: row.map((value) => docxCell(docx, value, {fill: index % 2 ? "F7F9F8" : undefined}))}));
      }
    });
    return new docx.Table({
      width: {size: 100, type: docx.WidthType.PERCENTAGE},
      borders: docxBorders(docx),
      rows
    });
  }

  async function exportDocx(model) {
    const docx = window.docx;
    if (!docx?.Document || !docx?.Packer) throw new Error("DOCX 생성 모듈을 불러오지 못했습니다.");
    const children = [
      new docx.Paragraph({spacing: {after: 120}, children: [new docx.TextRun({text: "토지한눈", bold: true, color: COLORS.green, font: DOCX_FONT, size: 22})]}),
      new docx.Paragraph({spacing: {after: 150}, children: [new docx.TextRun({text: model.title, bold: true, color: "000000", font: DOCX_FONT, size: 38})]}),
      new docx.Paragraph({spacing: {after: 80}, children: [new docx.TextRun({text: model.address, bold: true, color: COLORS.ink, font: DOCX_FONT, size: 26})]}),
      new docx.Paragraph({spacing: {after: 320}, children: [new docx.TextRun({text: `도로명 ${safeValue(model.road)}    작성일 ${model.generatedAt}    PNU ${safeValue(model.pnu)}`, color: COLORS.soft, font: DOCX_FONT, size: 18})]})
    ];

    if (model.mapImage) {
      children.push(
        new docx.Paragraph({keepNext: true, spacing: {before: 80, after: 120}, children: [new docx.TextRun({text: "필지 주변 지도", bold: true, color: "000000", font: DOCX_FONT, size: 27})]}),
        new docx.Paragraph({alignment: docx.AlignmentType.CENTER, spacing: {after: 80}, children: [new docx.ImageRun({
          data: model.mapImage,
          type: "jpg",
          transformation: {width: 640, height: 360},
          altText: {title: "필지 주변 지도", description: `${model.address} 선택 필지 경계가 표시된 VWorld 지도`, name: "필지 주변 지도"}
        })]}),
        new docx.Paragraph({spacing: {after: 180}, children: [new docx.TextRun({text: "VWorld 배경지도 · 선택 필지 경계 강조 · 참고용", color: COLORS.soft, font: DOCX_FONT, size: 16})]})
      );
    }

    model.sections.forEach((section) => {
      children.push(new docx.Paragraph({
        keepNext: true,
        spacing: {before: 320, after: 120},
        children: [new docx.TextRun({text: section.title, bold: true, color: "000000", font: DOCX_FONT, size: 27})]
      }));
      children.push(docxTable(docx, section));
    });

    children.push(
      new docx.Paragraph({spacing: {before: 340, after: 100}, children: [new docx.TextRun({text: model.notice, color: COLORS.soft, font: DOCX_FONT, size: 18})]}),
      new docx.Paragraph({children: [new docx.TextRun({text: `${model.source}  |  토지한눈 자동 생성 보고서`, color: "78857F", font: DOCX_FONT, size: 16})]})
    );

    const documentFile = new docx.Document({
      creator: "토지한눈",
      title: `${model.address} 토지정보 조회 보고서`,
      description: "VWorld 공개 API 토지정보를 정리한 참고용 보고서",
      styles: {default: {document: {run: {font: DOCX_FONT, size: 22, color: COLORS.ink}, paragraph: {spacing: {line: 300}}}}},
      sections: [{
        properties: {
          page: {
            size: {width: 11906, height: 16838},
            margin: {top: 1134, right: 1134, bottom: 1134, left: 1134}
          }
        },
        children
      }]
    });
    const blob = await docx.Packer.toBlob(documentFile);
    saveBlob(blob, fileName(model, "docx"));
  }

  function pptxRows(section) {
    if (section.kind === "keyValue") return {headers: ["항목", "내용"], rows: section.rows};
    return {headers: section.headers || ["내용"], rows: section.rows || []};
  }

  function addPptxHeading(slide, title, subtitle, pageNumber) {
    slide.addText(title, {x: 0.65, y: 0.48, w: 11.9, h: 0.45, fontFace: "NanumGothic", fontSize: 24, bold: true, color: "111111", margin: 0});
    slide.addText(subtitle, {x: 0.65, y: 0.99, w: 11.9, h: 0.28, fontFace: "NanumGothic", fontSize: 9, color: COLORS.soft, margin: 0});
    slide.addText(String(pageNumber), {x: 12.2, y: 7.12, w: 0.45, h: 0.2, fontFace: "Arial", fontSize: 8, color: "78857F", align: "right", margin: 0});
  }

  async function exportPptx(model) {
    if (typeof window.PptxGenJS !== "function") throw new Error("PPTX 생성 모듈을 불러오지 못했습니다.");
    const pptx = new window.PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "토지한눈";
    pptx.company = "토지한눈";
    pptx.subject = `${model.address} 토지정보`;
    pptx.title = model.title;
    pptx.lang = "ko-KR";
    pptx.theme = {headFontFace: "NanumGothic", bodyFontFace: "NanumGothic", lang: "ko-KR"};

    let pageNumber = 1;
    const cover = pptx.addSlide();
    cover.background = {color: "F4F9F6"};
    cover.addText("토지한눈", {x: 0.85, y: 0.8, w: 3, h: 0.4, fontFace: "NanumGothic", fontSize: 18, bold: true, color: COLORS.green, margin: 0});
    cover.addText(model.title, {x: 0.85, y: 2.05, w: 11.4, h: 0.8, fontFace: "NanumGothic", fontSize: 36, bold: true, color: "111111", margin: 0});
    cover.addText(model.address, {x: 0.85, y: 3.03, w: 11.4, h: 0.6, fontFace: "NanumGothic", fontSize: 22, bold: true, color: COLORS.ink, margin: 0});
    cover.addText(`도로명 ${safeValue(model.road)}\nPNU ${safeValue(model.pnu)}\n작성일 ${model.generatedAt}`, {x: 0.85, y: 4.0, w: 10.8, h: 1.2, fontFace: "NanumGothic", fontSize: 14, color: COLORS.soft, breakLine: false, margin: 0, paraSpaceAfterPt: 8});
    cover.addText(model.notice, {x: 0.85, y: 6.35, w: 11.5, h: 0.45, fontFace: "NanumGothic", fontSize: 9, color: COLORS.soft, margin: 0});
    cover.addText(String(pageNumber), {x: 12.2, y: 7.12, w: 0.45, h: 0.2, fontFace: "Arial", fontSize: 8, color: "78857F", align: "right", margin: 0});

    if (model.mapImage) {
      pageNumber += 1;
      const mapSlide = pptx.addSlide();
      addPptxHeading(mapSlide, "필지 주변 지도", model.address, pageNumber);
      mapSlide.addImage({data: model.mapImage, x: 0.65, y: 1.42, w: 12.0, h: 5.55});
      mapSlide.addText("VWorld 배경지도 · 선택 필지 경계 강조 · 참고용", {x: 0.65, y: 7.0, w: 8.5, h: 0.2, fontFace: "NanumGothic", fontSize: 8, color: "78857F", margin: 0});
    }

    model.sections.forEach((section) => {
      const table = pptxRows(section);
      const rows = table.rows.length ? table.rows : [["조회된 정보가 없습니다.", "-"]];
      const chunkSize = Math.max(5, Math.min(10, 12 - table.headers.length));
      for (let start = 0; start < rows.length; start += chunkSize) {
        pageNumber += 1;
        const slide = pptx.addSlide();
        const continued = start ? " 계속" : "";
        addPptxHeading(slide, `${section.title}${continued}`, model.address, pageNumber);
        const chunk = rows.slice(start, start + chunkSize);
        const pptRows = [
          table.headers.map((header) => ({text: safeValue(header), options: {bold: true, color: COLORS.white, fill: COLORS.green, align: "center"}})),
          ...chunk.map((row, rowIndex) => row.map((value) => ({text: safeValue(value), options: {fill: rowIndex % 2 ? "F7F9F8" : COLORS.white}})))
        ];
        slide.addTable(pptRows, {
          x: 0.65, y: 1.5, w: 12.0,
          border: {type: "solid", pt: 0.7, color: COLORS.line},
          color: COLORS.ink,
          fontFace: "NanumGothic",
          fontSize: 13,
          margin: 0.08,
          breakLine: false,
          rowH: 0.48
        });
        slide.addText(model.source, {x: 0.65, y: 7.08, w: 8.5, h: 0.2, fontFace: "NanumGothic", fontSize: 8, color: "78857F", margin: 0});
      }
    });
    await pptx.writeFile({fileName: fileName(model, "pptx"), compression: true});
  }

  function hwpxHtml(model) {
    return `<h1>${escapeHtml(model.title)}</h1>
      <p><strong>${escapeHtml(model.address)}</strong></p>
      <p>도로명 ${escapeHtml(safeValue(model.road))}<br>PNU ${escapeHtml(safeValue(model.pnu))}<br>작성일 ${escapeHtml(model.generatedAt)}</p>
      ${model.mapImage ? `<h2>필지 주변 지도</h2><p><img src="${escapeHtml(model.mapImage)}" alt="${escapeHtml(model.address)} 필지 주변 지도" style="width:100%;height:auto"></p><p>VWorld 배경지도 · 선택 필지 경계 강조 · 참고용</p>` : ""}
      ${model.sections.map((section) => `<h2>${escapeHtml(section.title)}</h2>${sectionTableHtml(section)}`).join("")}
      <p>${escapeHtml(model.notice)}</p><p>${escapeHtml(model.source)}</p>`;
  }

  async function exportHwpx(model) {
    const module = await import("https://cdn.jsdelivr.net/npm/@ssabrojs/hwpxjs@0.4.0/dist/browser/hwpxjs.browser.mjs");
    if (typeof module.htmlToHwpx !== "function") throw new Error("HWPX 생성 모듈을 불러오지 못했습니다.");
    const bytes = await module.htmlToHwpx(hwpxHtml(model), {title: model.title, creator: "토지한눈"});
    saveBlob(new Blob([bytes], {type: "application/vnd.hancom.hwpx"}), fileName(model, "hwpx"));
  }

  async function exportReport(model, format) {
    switch (format) {
      case "pdf": return exportPdf(model);
      case "docx": return exportDocx(model);
      case "hwpx": return exportHwpx(model);
      case "pptx": return exportPptx(model);
      case "png":
      case "jpg": return exportImage(model, format);
      default: throw new Error("지원하지 않는 다운로드 형식입니다.");
    }
  }

  window.ReportExporter = {exportReport, renderPreview};
})();
