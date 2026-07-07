// ================================================================
//  BUSCA SEMÂNTICA LOCAL (offline, sem modelo externo)
// ----------------------------------------------------------------
//  Busca por SENTIDO, não só por texto exato. Combina:
//   • normalização (tira acento/caixa);
//   • SINÔNIMOS do dia a dia jurídico (inventário↔espólio↔herança,
//     barco↔embarcação↔lancha, alimentos↔pensão, divórcio↔separação…);
//   • tolerância a ERRO DE DIGITAÇÃO (semelhança por bigramas);
//   • RANQUEAMENTO cruzando todos os campos (nome, CPF, partes, vara,
//     observações, andamentos…), com peso maior no título.
//
//  Assim, "aquele inventário do cliente que tinha um barco" encontra o
//  processo/cliente certo mesmo sem a frase exata estar cadastrada.
//  Tudo roda no aparelho — funciona sem internet.
// ================================================================

// Tira acentos e baixa a caixa.
export function norm(s) {
  return (s == null ? "" : String(s)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Palavras de ligação que não ajudam a discriminar (removidas dos termos).
const STOP = new Set([
  "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "e", "ou", "que", "com", "sem", "por", "para", "pra", "no", "na", "nos", "nas",
  "em", "ao", "aos", "meu", "meus", "minha", "minhas", "seu", "sua", "esse", "essa",
  "este", "esta", "aquele", "aquela", "aquilo", "isso", "isto", "tinha", "tem", "ter",
  "tinha", "era", "foi", "sobre", "the", "of", "me", "se", "qual", "quais", "quem",
  "onde", "quando", "aquele", "algum", "alguma", "todos", "todas",
]);

// Grupos de sinônimos do domínio (jurídico + bens/pessoas comuns). Cada termo de
// um grupo puxa os demais na busca. Amplie livremente conforme o uso.
const SYN_GROUPS = [
  ["inventario", "espolio", "heranca", "herdeiro", "herdeiros", "partilha", "sucessao", "arrolamento", "falecido", "obito", "de cujus"],
  ["divorcio", "separacao", "dissolucao", "casamento", "conjugal", "conjuge", "ex"],
  ["alimentos", "pensao", "alimenticia", "alimentar", "alimentando"],
  ["guarda", "visitas", "filho", "filhos", "menor", "crianca"],
  ["trabalhista", "trabalho", "clt", "emprego", "empregado", "rescisao", "verbas", "fgts", "hora extra", "horas extras"],
  ["previdenciario", "inss", "aposentadoria", "auxilio", "beneficio", "loas", "bpc"],
  ["consumidor", "consumo", "cdc", "produto", "servico", "vicio"],
  ["indenizacao", "danos", "dano", "moral", "material", "reparacao", "prejuizo"],
  ["cobranca", "execucao", "divida", "titulo", "cheque", "nota promissoria", "inadimplencia", "devedor"],
  ["despejo", "locacao", "aluguel", "locador", "locatario", "inquilino"],
  ["usucapiao", "posse", "possessoria", "reintegracao", "esbulho"],
  ["imovel", "imoveis", "casa", "apartamento", "apto", "terreno", "lote", "predio", "chacara", "sitio", "fazenda"],
  ["veiculo", "carro", "automovel", "moto", "motocicleta", "caminhao"],
  ["barco", "embarcacao", "lancha", "iate", "veleiro", "jet ski", "jetski", "navio"],
  ["empresa", "sociedade", "cnpj", "socio", "ltda", "empresarial", "comercial"],
  ["criminal", "crime", "penal", "delito", "reu", "denuncia", "flagrante"],
  ["contrato", "contratual", "acordo", "distrato", "clausula"],
  ["saude", "plano de saude", "medico", "hospital", "cirurgia", "tratamento", "remedio", "medicamento"],
  ["tributario", "imposto", "fiscal", "iptu", "icms", "tributo", "execucao fiscal"],
  ["banco", "bancario", "financiamento", "emprestimo", "juros", "cartao"],
];

// Índice simétrico termo → conjunto de sinônimos (inclui o próprio termo).
const SYN = (() => {
  const map = new Map();
  for (const grp of SYN_GROUPS) {
    const set = new Set(grp.map(norm).flatMap((t) => t.split(/\s+/))); // termos simples do grupo
    for (const raw of grp) {
      const key = norm(raw);
      for (const part of [key, ...key.split(/\s+/)]) {
        if (!map.has(part)) map.set(part, new Set());
        for (const s of set) map.get(part).add(s);
      }
    }
  }
  return map;
})();

export function tokenize(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));
}

// Conjunto de variantes de um termo (ele mesmo + sinônimos).
function expand(term) {
  const set = new Set([term]);
  const syn = SYN.get(term);
  if (syn) for (const s of syn) set.add(s);
  return set;
}

// Semelhança por bigramas (coeficiente de Dice) — pega erro de digitação.
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const big = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = big(a), B = big(b);
  let inter = 0, total = 0;
  for (const [g, c] of A) { total += c; if (B.has(g)) inter += Math.min(c, B.get(g)); }
  for (const c of B.values()) total += c;
  return (2 * inter) / total;
}

// Semelhança entre um termo da busca e um token do documento.
function sim(q, tok) {
  if (q === tok) return 1;
  if (q.length >= 3 && (tok.startsWith(q) || q.startsWith(tok))) return 0.85;
  const d = dice(q, tok);
  return d >= 0.6 ? d * 0.9 : 0;
}

function bestInTokens(q, toks) {
  let best = 0;
  for (const t of toks) { const s = sim(q, t); if (s > best) best = s; if (best === 1) break; }
  return best;
}

// Documento de busca: { ref, titleToks, bodyToks }
function toDocInternal(d) {
  return { ref: d.ref, titleToks: tokenize(d.title || ""), bodyToks: tokenize(((d.title || "") + " " + (d.text || "")).trim()) };
}

// Pontua um documento contra os termos da busca (média do melhor por termo,
// com peso extra quando casa no título). 0 = não casou.
function scoreDoc(doc, qTerms) {
  if (!qTerms.length) return 0;
  let total = 0, matched = 0;
  for (const qt of qTerms) {
    let best = 0;
    for (const v of expand(qt)) {
      const w = v === qt ? 1 : 0.9; // sinônimo vale um pouco menos que o termo exato
      const inTitle = bestInTokens(v, doc.titleToks) * 1.6;
      const inBody = bestInTokens(v, doc.bodyToks);
      best = Math.max(best, w * Math.max(inTitle, inBody));
    }
    if (best > 0.35) matched++;
    total += best;
  }
  // Exige que MAIS DA METADE dos termos tenha casado (evita falso positivo por
  // um único termo solto): busca curta vira "E"; frase longa tolera 1-2 palavras
  // de enchimento (ex.: "…do cliente que tinha um barco" = 2 de 3 casam).
  const coverage = matched / qTerms.length;
  if (coverage <= 0.5) return 0;
  return (total / qTerms.length) * (0.5 + 0.5 * coverage);
}

// API principal: ranqueia uma lista de documentos {ref, title, text}.
// Devolve [{ ref, score }] em ordem decrescente (score > threshold).
export function rank(query, docs, { limit = 12, threshold = 0.3 } = {}) {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return [];
  const internal = docs.map(toDocInternal);
  const out = [];
  for (const doc of internal) {
    const score = scoreDoc(doc, qTerms);
    if (score >= threshold) out.push({ ref: doc.ref, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// Conveniência: filtra/ranqueia REGISTROS. toDoc(record) => { title, text }.
// Query vazia → devolve os registros na ordem original (sem filtrar).
export function filterRecords(query, records, toDoc, opts = {}) {
  if (!query || !query.trim()) return records.slice();
  const docs = records.map((r) => ({ ref: r, ...toDoc(r) }));
  return rank(query, docs, opts).map((x) => x.ref);
}
