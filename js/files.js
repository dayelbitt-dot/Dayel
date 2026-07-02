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
  // PDF escaneado (imagem, sem texto) → tenta OCR
  if (!out) { onProgress("📄 PDF sem texto — tentando reconhecer imagem…"); return await imageToText(file, onProgress); }
  return out;
}

async function imageToText(file, onProgress) {
  onProgress("🔍 Carregando reconhecimento de texto…");
  const mod = await loadFirst([
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm",
    "https://esm.sh/tesseract.js@5",
    "https://unpkg.com/tesseract.js@5/dist/tesseract.esm.min.js",
  ]);
  const Tesseract = mod.default || mod;
  const { data } = await Tesseract.recognize(file, "por", {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5",
    logger: (m) => {
      if (m.status === "recognizing text")
        onProgress(`🔍 Reconhecendo texto… ${Math.round(m.progress * 100)}%`);
    },
  });
  return (data.text || "").replace(/\s+\n/g, "\n").trim();
}
