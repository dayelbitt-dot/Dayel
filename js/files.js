// Extrai texto de arquivos enviados pelo usuário.
//  - .txt / .md / .csv / texto  → leitura direta (funciona offline)
//  - PDF (com texto)            → pdf.js
//  - imagens (foto/print)       → OCR com Tesseract.js (português)
//
// PDF e OCR usam bibliotecas carregadas de uma CDN pública na primeira vez
// (precisam de internet). Tentamos algumas CDNs para maior resiliência.

async function loadFirst(urls) {
  let lastErr;
  for (const url of urls) {
    try { return await import(url); }
    catch (e) { lastErr = e; }
  }
  throw new Error("não foi possível carregar a biblioteca (verifique sua conexão)");
}

export async function extractTextFromFile(file, onProgress = () => {}) {
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";

  // Texto puro (offline)
  if (type.startsWith("text/") || /\.(txt|md|csv|log|json)$/.test(name)) {
    return await file.text();
  }

  // Planilha Excel (.xlsx/.xls) → texto (converte a 1ª aba para linhas de texto)
  if (/\.(xlsx|xls)$/.test(name) || /sheet|excel|ms-excel/.test(type)) {
    return await excelToText(file, onProgress);
  }

  // PDF
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    return await pdfToText(file, onProgress);
  }

  // Imagem → OCR
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) {
    return await imageToText(file, onProgress);
  }

  // Última tentativa: ler como texto
  try { return await file.text(); } catch { return ""; }
}

// Converte uma planilha Excel (.xlsx/.xls) em texto: cada aba vira um bloco de
// linhas (colunas separadas por " | "), para as regras/IA lerem o conteúdo.
async function excelToText(file, onProgress) {
  onProgress("📊 Lendo a planilha… (a 1ª vez carrega o leitor — precisa de internet)");
  const XLSX = await loadFirst([
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm",
    "https://esm.sh/xlsx@0.18.5",
    "https://unpkg.com/xlsx@0.18.5/xlsx.mjs",
  ]);
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const partes = [];
  for (const nome of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, blankrows: false });
    const linhas = aoa
      .map((row) => (row || []).map((c) => (c == null ? "" : String(c)).replace(/\s+/g, " ").trim()).join(" | ").replace(/(\s*\|\s*)+$/, "").trim())
      .filter((l) => l.replace(/[|\s]/g, ""));
    if (linhas.length) partes.push((wb.SheetNames.length > 1 ? `# ${nome}\n` : "") + linhas.join("\n"));
  }
  return partes.join("\n\n").trim();
}

async function pdfToText(file, onProgress) {
  onProgress("📄 Carregando leitor de PDF…");
  const V = "4.6.82";
  const pdfjs = await loadFirst([
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.min.mjs`,
    `https://esm.sh/pdfjs-dist@${V}/build/pdf.mjs`,
    `https://unpkg.com/pdfjs-dist@${V}/build/pdf.min.mjs`,
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`📄 Lendo página ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => it.str).join(" ") + "\n";
  }
  out = out.trim();
  // PDF escaneado (páginas são imagem, sem texto embutido) → renderiza cada
  // página num canvas e reconhece o texto (OCR). Não dá para OCR do PDF direto:
  // o Tesseract só entende imagem, então precisamos rasterizar antes.
  if (out.replace(/\s/g, "").length < 8) {
    onProgress("📄 PDF escaneado — reconhecendo o texto das páginas…");
    const worker = await makeOcrWorker(onProgress);
    try {
      let ocr = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        onProgress(`🔍 Reconhecendo página ${i}/${pdf.numPages}…`);
        const canvas = await pageToCanvas(pdf, i, pdfjs);
        const { data: d } = await worker.recognize(canvas);
        ocr += (d.text || "") + "\n";
      }
      return ocr.replace(/\s+\n/g, "\n").trim();
    } finally { try { await worker.terminate(); } catch {} }
  }
  return out;
}

// Renderiza uma página do PDF num <canvas> (escala 2x para o OCR ficar nítido).
async function pageToCanvas(pdf, pageNum, pdfjs) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Cria um worker de OCR reaproveitável (evita recarregar a biblioteca a cada página).
async function makeOcrWorker(onProgress) {
  onProgress("🔍 Carregando reconhecimento de texto…");
  const mod = await loadFirst([
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm",
    "https://esm.sh/tesseract.js@5",
    "https://unpkg.com/tesseract.js@5/dist/tesseract.esm.min.js",
  ]);
  const Tesseract = mod.default || mod;
  return await Tesseract.createWorker("por", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5",
    logger: (m) => {
      if (m.status === "recognizing text")
        onProgress(`🔍 Reconhecendo texto… ${Math.round(m.progress * 100)}%`);
    },
  });
}

async function imageToText(file, onProgress) {
  const worker = await makeOcrWorker(onProgress);
  try {
    const { data } = await worker.recognize(file);
    return (data.text || "").replace(/\s+\n/g, "\n").trim();
  } finally { try { await worker.terminate(); } catch {} }
}
