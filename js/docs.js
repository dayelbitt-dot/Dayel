// Geração de documentos (procuração e declaração de hipossuficiência) a partir
// dos MODELOS .docx em /templates. Preserva 100% a formatação: só troca os
// marcadores ([[NOME]], [[QUALIF]]…) pelo texto do cliente, mantendo fonte,
// tamanho e estilo do arquivo original. Usa JSZip (empacotado, funciona offline).

import { el, toast } from "./ui.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Catálogo dos documentos disponíveis.
export const DOCS = [
  { key: "procuracao_judicial", label: "Procuração Judicial", ico: "⚖️", precisa: ["objeto"] },
  { key: "procuracao_extrajudicial", label: "Procuração Extrajudicial", ico: "📝", precisa: [] },
  { key: "declaracao", label: "Declaração de Hipossuficiência", ico: "🧾", precisa: ["situacao"] },
];
const TITULO = { procuracao_judicial: "Procuração Judicial", procuracao_extrajudicial: "Procuração Extrajudicial", declaracao: "Declaração de Hipossuficiência" };

// Carrega o JSZip (empacotado no projeto) uma única vez.
let _zipPromise = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (_zipPromise) return _zipPromise;
  _zipPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/jszip.min.js";
    s.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("JSZip não carregou"));
    s.onerror = () => reject(new Error("Não consegui carregar a biblioteca de documentos."));
    document.head.append(s);
  });
  return _zipPromise;
}

const escapeXml = (s) => (s == null ? "" : String(s)).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function dataPorExtenso(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+d} de ${MESES[+m - 1]} de ${y}.`;
}

// Concordância de gênero — INFERIDA do que já está no modelo (nacionalidade e
// estado civil que o usuário informa: "brasileira", "casada" = feminino).
function ehFeminino(d) {
  const nac = (d.nacionalidade || "").trim().toLowerCase();
  if (/a$/.test(nac)) return true;
  if (/o$/.test(nac)) return false;
  const ec = (d.estadoCivil || "").trim().toLowerCase();
  if (/a$/.test(ec)) return true;
  if (/o$/.test(ec)) return false;
  return false; // padrão masculino quando não dá para inferir
}
function genero(d) {
  const fem = ehFeminino(d);
  return {
    nac: fem ? "brasileira" : "brasileiro",
    inscr: fem ? "inscrita" : "inscrito",
    port: fem ? "portadora" : "portador",
    res: fem ? "residente e domiciliada" : "residente e domiciliado",
  };
}

// Qualificação para PROCURAÇÃO: começa com vírgula, inclui RG, termina em ponto.
function qualifProcuracao(d) {
  const g = genero(d);
  const nac = (d.nacionalidade || g.nac).trim();
  const bits = [nac, d.estadoCivil, d.profissao].map((x) => (x || "").trim()).filter(Boolean).join(", ");
  const rg = (d.rg || "").trim() ? `, ${g.port} do RG nº ${d.rg.trim()}` : "";
  const cpf = (d.cpf || "").trim() ? `, ${g.inscr} no CPF nº ${d.cpf.trim()}` : "";
  const end = (d.endereco || "").trim() ? `, ${g.res} à ${d.endereco.trim()}` : "";
  return `, ${bits}${cpf}${rg}${end}.`;
}

// Qualificação para DECLARAÇÃO: inclui o nome, sem RG, sem ponto final.
function qualifDeclaracao(d) {
  const g = genero(d);
  const nac = (d.nacionalidade || g.nac).trim();
  const bits = [nac, d.estadoCivil, d.profissao].map((x) => (x || "").trim()).filter(Boolean).join(", ");
  const cpf = (d.cpf || "").trim() ? `, ${g.inscr} no CPF nº ${d.cpf.trim()}` : "";
  const end = (d.endereco || "").trim() ? `, ${g.res} à ${d.endereco.trim()}` : "";
  return `${(d.nome || "").trim()}, ${bits}${cpf}${end}`;
}

function tokensFor(tipo, d) {
  const data = dataPorExtenso(d.dataISO);
  if (tipo === "declaracao") {
    return {
      "[[QUALIF]]": qualifDeclaracao(d),
      "[[SITUACAO]]": (d.situacao || d.profissao || "").trim(),
      "[[DATA]]": data,
      "[[NOME]]": (d.nome || "").trim(),
      "[[CPF]]": (d.cpf || "").trim(),
    };
  }
  // procurações
  return {
    "[[NOME]]": (d.nome || "").trim(),
    "[[QUALIF]]": qualifProcuracao(d),
    "[[OBJETO]]": (d.objeto || "").trim(),
    "[[DATA]]": data,
    "[[CPF]]": (d.cpf || "").trim(),
  };
}

// Gera um documento e dispara o download.
export async function gerarDocumento(tipo, dados) {
  const JSZip = await loadJSZip();
  const resp = await fetch(`templates/${tipo}.docx`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Modelo não encontrado (${tipo}).`);
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());
  let xml = await zip.file("word/document.xml").async("string");
  for (const [tok, val] of Object.entries(tokensFor(tipo, dados))) {
    xml = xml.split(tok).join(escapeXml(val));
  }
  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const nome = (dados.nome || "documento").trim().replace(/[\\/:*?"<>|]+/g, " ").trim();
  baixar(blob, `${TITULO[tipo]} - ${nome}.docx`);
}

export async function gerarDocumentos(tipos, dados) {
  for (const t of tipos) await gerarDocumento(t, dados);
}

function baixar(blob, filename) {
  const a = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
