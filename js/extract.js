// Extração de campos estruturados a partir de texto livre ou de documentos
// (o texto já vem extraído por files.js: PDF, imagem/OCR, txt/csv). Heurísticas
// em pt-BR: procura rótulos ("Nome:", "CPF:", "Processo:", …) e também padrões
// soltos (CPF/CNPJ, e-mail, telefone, CEP, número CNJ, valores). Tudo roda no
// navegador — sem servidor e sem IA — na mesma linha de nlp.js e planilha.js.

const clean = (s) => (s || "").toString().replace(/[ \t]+/g, " ").trim();
const noAccent = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Rótulos conhecidos: usamos para "cortar" um valor quando vários campos vêm
// na mesma linha (ex: "Nome: João  CPF: 123..." → nome para em "CPF:").
const STOP = /\b(nome|cpf|cnpj|rg|identidade|tel(?:efone)?|celular|whats\s?app|e-?mail|nascimento|data\s+de\s+nascimento|nascid[oa]|endere[cç]o|residente|domiciliad[oa]|cep|estado\s+civil|profiss[aã]o|nacionalidade|naturalidade|filia[cç][aã]o|processo|autos|n[uú]mero|vara|ju[ií]zo|comarca|foro|tribunal|[oó]rg[aã]o|classe|assunto|natureza|valor|distribu\w*|ajuiza\w*|fase|situa[cç][aã]o|r[eé]u|requerid[oa]|executad[oa]|apelad[oa]|parte\s+contr[aá]ria|origem|[aá]rea)\b\s*[:\-–]/i;

// Recorta o valor de um rótulo: pega até a quebra de linha e corta no próximo
// rótulo conhecido (para não engolir o campo seguinte).
function cut(v) {
  if (!v) return "";
  v = v.split(/\n/)[0];
  const s = v.search(STOP);
  if (s > 0) v = v.slice(0, s);
  return clean(v).replace(/[\s;,.]+$/, "");
}

// Procura "rótulo: valor" (exige o separador : - – para evitar falsos positivos).
function labeled(text, labelSrc) {
  const re = new RegExp("(?:^|\\n)[ \\t]*(?:" + labelSrc + ")[ \\t]*[:\\-–][ \\t]*([^\\n]+)", "i");
  const m = text.match(re);
  return m ? cut(m[1]) : "";
}

// dd/mm/aaaa (ou dd/mm/aa) → ISO aaaa-mm-dd. Também aceita "dd de mês de aaaa".
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
// Monta um ISO só se for uma data de calendário REAL (rejeita 30/02, 31/04…).
function isoIfValid(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function brDateToISO(s) {
  if (!s) return null;
  let m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    // Ano de 2 dígitos: janela 00–29 → 2000s, 30–99 → 1900s (cobre nascimentos
    // antigos como "50" → 1950 sem jogar tudo para o futuro).
    if (y < 100) y += y <= 29 ? 2000 : 1900;
    const iso = isoIfValid(y, +m[2], +m[1]);
    if (iso) return iso;
  }
  m = noAccent(s.toLowerCase()).match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (m && MESES[m[2]]) return isoIfValid(+m[3], MESES[m[2]], +m[1]);
  return null;
}

// "R$ 15.000,00" / "15.000" / "15000" → número (padrão pt-BR: ponto = milhar,
// vírgula = decimal). "15.000" vale 15000 (e NÃO 15) — sem vírgula, o ponto é
// sempre separador de milhar.
export function parseMoney(s) {
  if (s == null) return null;
  let v = String(s).replace(/[^\d.,-]/g, "");
  if (!v) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", "."); // vírgula decide o decimal
  else v = v.replace(/\./g, "");                                    // só pontos → milhar
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function firstMatch(text, re) { const m = text.match(re); return m ? m[0] : ""; }

// Formata 11 dígitos como CPF; 14 como CNPJ.
function fmtDoc(digits) {
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digits;
}

// Heurística: uma linha que "parece" nome de pessoa (2 a 6 palavras, só letras).
function guessName(text) {
  for (const raw of text.split(/\n/)) {
    const line = clean(raw);
    if (!line || /\d/.test(line)) continue;
    if (STOP.test(line + ":")) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 6) continue;
    if (!/^[A-ZÀ-Ý][\p{L}'.-]*(\s+[\p{L}'.-]+)+$/u.test(line)) continue;
    if (line.length > 60) continue;
    return line;
  }
  return "";
}

// ------------------------------------------------------------------
//  CLIENTE
// ------------------------------------------------------------------
export function extractClient(text) {
  text = (text || "").replace(/\r/g, "");
  const out = { nome: "", cpf: "", rg: "", tel: "", email: "", nasc: null, endereco: "", area: "", origem: "", obs: "" };

  out.nome = labeled(text, "nome\\s+completo|nome\\s+do\\s+cliente|nome|cliente|requerente|autora?|contratante|outorgante") || guessName(text);

  // CPF (formatado) ou CNPJ; senão dígitos junto ao rótulo.
  const cpfFmt = firstMatch(text, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
  const cnpjFmt = firstMatch(text, /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (cpfFmt) out.cpf = cpfFmt;
  else if (cnpjFmt) out.cpf = cnpjFmt;
  else {
    const lc = labeled(text, "cpf");
    const lj = labeled(text, "cnpj");
    if (lc) { const d = lc.replace(/\D/g, ""); if (d.length === 11) out.cpf = fmtDoc(d); }
    else if (lj) { const d = lj.replace(/\D/g, ""); if (d.length === 14) out.cpf = fmtDoc(d); }
  }

  out.rg = labeled(text, "rg|registro\\s+geral|identidade|carteira\\s+de\\s+identidade");
  out.tel = labeled(text, "telefone|tel|celular|whats\\s?app|fone|contato")
    || firstMatch(text, /\(?\d{2}\)?\s*9?\d{4}[-\s]\d{4}/);
  out.email = labeled(text, "e-?mail") || firstMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  out.nasc = brDateToISO(labeled(text, "data\\s+de\\s+nascimento|nascimento|nascid[oa]\\s+em|nascid[oa]"));

  let endereco = labeled(text, "endere[cç]o|residente(?:\\s+e\\s+domiciliad[oa])?|domiciliad[oa]|logradouro");
  const cep = firstMatch(text, /\b\d{5}-\d{3}\b/);
  if (cep && !/\d{5}-\d{3}/.test(endereco)) endereco = clean(endereco + (endereco ? " — CEP " : "CEP ") + cep);
  out.endereco = endereco;

  out.area = labeled(text, "[aá]rea(?:\\s+do\\s+direito)?|[aá]rea\\s+jur[ií]dica");
  out.origem = labeled(text, "origem|indica[cç][aã]o|como\\s+chegou|captado\\s+por");

  // Campos sem lugar próprio → viram Observações (nada se perde).
  const extras = [];
  const civil = labeled(text, "estado\\s+civil"); if (civil) extras.push("Estado civil: " + civil);
  const prof = labeled(text, "profiss[aã]o|ocupa[cç][aã]o"); if (prof) extras.push("Profissão: " + prof);
  const nat = labeled(text, "nacionalidade|naturalidade"); if (nat) extras.push("Nacionalidade/naturalidade: " + nat);
  const fil = labeled(text, "filia[cç][aã]o|m[aã]e|pai"); if (fil) extras.push("Filiação: " + fil);
  out.obs = extras.join(" · ");

  return out;
}

// ------------------------------------------------------------------
//  PROCESSO
// ------------------------------------------------------------------
export function extractProcess(text) {
  text = (text || "").replace(/\r/g, "");
  const nl = noAccent(text.toLowerCase());
  const out = { num: "", nome: "", tipo: "", vara: "", tribunal: "", partes: "", data_distribuicao: null, fase: "", valor: null, grau: "1", obs: "" };

  out.num = firstMatch(text, /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/);
  if (!out.num) { const l = labeled(text, "processo|autos|n[uú]mero\\s+do\\s+processo|n[uú]mero|cnj"); if (l) out.num = l; }

  out.tipo = labeled(text, "tipo\\s+de\\s+a[cç][aã]o|tipo|classe(?:\\s+processual)?|a[cç][aã]o|assunto|natureza\\s+da\\s+a[cç][aã]o|natureza");

  let vara = labeled(text, "vara|ju[ií]zo") || firstMatch(text, /\d+[ªaº°]?\s*Vara[^\n,;.]*/i);
  const comarca = labeled(text, "comarca|foro") || (firstMatch(text, /Comarca\s+de\s+[^\n,;.]+/i).replace(/^Comarca\s+de\s+/i, ""));
  out.vara = clean([vara, comarca].filter(Boolean).join(" — "));

  out.tribunal = labeled(text, "tribunal|[oó]rg[aã]o(?:\\s+julgador)?|c[aâ]mara|turma")
    || firstMatch(text, /\b(?:TJ[A-Z]{2}|TRF\s?-?\s?\d|TRT\s?-?\s?\d{1,2}|TJ\s?-?\s?[A-Z]{2}|STJ|STF|TST)\b/);

  out.partes = labeled(text, "r[eé]u|requerid[oa]|executad[oa]|apelad[oa]|parte\\s+contr[aá]ria|adverso|r[eé]");
  out.data_distribuicao = brDateToISO(labeled(text, "distribu[ií][cç][aã]o|distribu[ií]d[oa]\\s+em|data\\s+de\\s+distribui[cç][aã]o|ajuizamento|ajuizad[oa]\\s+em"));
  out.fase = labeled(text, "fase(?:\\s+atual|\\s+processual)?|situa[cç][aã]o");

  const valorLbl = labeled(text, "valor\\s+da\\s+causa|valor\\s+da\\s+a[cç][aã]o|valor");
  out.valor = parseMoney(valorLbl || firstMatch(text, /R\$\s*[\d.]+(?:,\d{2})?/));

  // Grau: 2º grau só com sinais claros de recurso/instância superior. A simples
  // presença de "TJRS"/"TJ" NÃO conta (a 1ª instância também tramita no TJ) — e
  // a menção a uma "Xª Vara" ou "1º grau" mantém em 1º grau.
  const has2 = /2[º°oa]?\s*grau|segund[ao]\s+inst[aâ]ncia|\bc[aâ]mara\b|\bturma\b|apela[cç]\w*|agravo|recurso\s+(especial|extraordin[aá]rio|inominado)|\bstj\b|\bstf\b|\btst\b/;
  const has1 = /1[º°oa]?\s*grau|primeir[ao]\s+inst[aâ]ncia|\d+[ªaº°]\s*vara/;
  if (has2.test(nl) && !has1.test(nl)) out.grau = "2";

  return out;
}
