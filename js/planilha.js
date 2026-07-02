// Leitura de planilhas de processos: detecta colunas, identifica o grau
// (1º/2º) e casa cada linha com um CLIENTE já cadastrado (sem criar novos).

export const normH = (s) =>
  (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export function parseValorP(s) {
  if (s == null) return null;
  let v = String(s).replace(/[^\d.,-]/g, "");
  if (!v) return null;
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(",", ".");
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Colunas que representam a PARTE CONTRÁRIA (nunca são o seu cliente) e
// colunas de advogado/procurador (também não devem virar cliente).
const OPP_RE = /contrari|advers|\bre[uú]\b|requerid|executad|apelad|recorrid|agravad|litisconsort|impetrad|embargad|denunciad|reclamad/;
const LAWYER_RE = /advog|oab|procurador|escritorio|patrono|causidico/;
// Colunas que indicam claramente o SEU cliente (lado ativo/representado).
const CLIENT_RE = /cliente|autor|requerente|exequente|impetrante|reclamante|embargante|agravante|apelante|recorrente|exequente|parte\s*ativa|representad/;

// A partir dos nomes das colunas, descobre qual é cada campo.
export function detectColumns(keys) {
  const find = (re) => keys.find((k) => re.test(normH(k)));
  const isOpp = (k) => OPP_RE.test(normH(k));
  const isLawyer = (k) => LAWYER_RE.test(normH(k));

  // Colunas de nome ligadas ao SEU cliente, em ordem de prioridade:
  // 1) explicitamente "cliente"  2) autor/requerente/etc  3) "parte"/"nome" genéricos
  // Nunca inclui parte contrária nem advogado.
  const nameLike = (k) => /cliente|parte|autor|re[uú]|requerente|requerido|exequente|executado|nome|adverso|apelante|apelad|agravante|agravad|recorrente|recorrid|impetr|reclam|embarg/.test(normH(k));
  const cand = keys.filter((k) => nameLike(k) && !isOpp(k) && !isLawyer(k));
  const rank = (k) => {
    const h = normH(k);
    if (/cliente/.test(h)) return 0;
    if (CLIENT_RE.test(h)) return 1;
    return 2; // "parte"/"nome" genérico
  };
  const clientCols = cand.slice().sort((a, b) => rank(a) - rank(b));
  const oppCols = keys.filter((k) => isOpp(k));

  return {
    num: find(/processo|numero|n[º°]|cnj|autos/),
    grau: find(/grau|instancia/),
    tipo: find(/tipo|acao|classe|assunto|natureza/),
    vara: find(/vara|juizo/),
    comarca: find(/comarca|foro/),
    tribunal: find(/tribunal|orgao|camara|turma/),
    valor: find(/valor/),
    fase: find(/fase|situacao|status/),
    clientCols,               // colunas do SEU cliente (para casar)
    oppCols,                  // colunas da parte contrária
    // compatibilidade: nameCols = cliente + contrária (para nomear o processo)
    nameCols: clientCols.concat(oppCols),
  };
}

// Descobre o grau (1 ou 2) pela coluna de grau, ou infere do tribunal/tipo.
export function inferGrau(row, cols) {
  const g = normH(cols.grau ? row[cols.grau] : "");
  if (/(^|\D)2|segund|superior|recurs|apela|agravo|camara|turma/.test(g)) return "2";
  if (/(^|\D)1|primeir|origem/.test(g)) return "1";
  const tb = normH(cols.tribunal ? row[cols.tribunal] : "");
  if (/tjrs|tj|trf|trt|stj|stf|camara|turma|apela/.test(tb)) return "2";
  const tp = normH(cols.tipo ? row[cols.tipo] : "");
  if (/apela|agravo|recurs|embargos de decl/.test(tp)) return "2";
  return "1";
}

// Quanto o nome do cliente combina com o conteúdo de uma célula (0 a 1).
// Usa os "tokens" (palavras) do nome — ignora conectivos como de/da/dos.
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "sa", "s.a", "ltda", "me", "eireli", "cia"]);
function nameScore(cellNorm, clientNorm) {
  if (!cellNorm || !clientNorm) return 0;
  if (clientNorm.length >= 4 && cellNorm.includes(clientNorm)) return 1; // contém o nome inteiro
  const toks = clientNorm.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!toks.length) return 0;
  let hit = 0, strong = 0;
  for (const w of toks) { if (cellNorm.includes(w)) { hit++; if (w.length >= 4) strong++; } }
  // exige a maioria dos tokens e ao menos um token "forte" (>=4 letras)
  return strong >= 1 && hit / toks.length >= 0.6 ? hit / toks.length : 0;
}

// Casa a linha com um cliente já cadastrado — SOMENTE pelas colunas do seu
// cliente (nunca pela parte contrária/advogado); senão, pelo número de um
// processo já existente. Assim a parte adversa não vira "cliente" por engano.
export function matchClient(row, cols, clients, processes) {
  const searchCols = (cols.clientCols && cols.clientCols.length ? cols.clientCols : cols.nameCols) || [];
  let best = null, bestScore = 0;
  for (const nc of searchCols) {
    const cell = normH(row[nc]);
    if (!cell) continue;
    for (const c of clients) {
      const s = nameScore(cell, normH(c.nome));
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (bestScore === 1) break; // achou o nome inteiro numa coluna do cliente
  }
  if (best) return { client: best, how: "nome" };

  const digits = normH(cols.num ? row[cols.num] : "").replace(/\D/g, "");
  if (digits) {
    for (const p of processes || []) {
      if (!p.client_id) continue;
      const pn = normH(p.num).replace(/\D/g, "");
      if (pn && pn === digits) {
        const c = clients.find((x) => x.id === p.client_id);
        if (c) return { client: c, how: "processo" };
      }
    }
  }
  return { client: null, how: null };
}

// Monta o objeto do processo a partir da linha.
export function buildProcessFromRow(row, cols, client) {
  const S = (key) => (cols[key] ? (row[cols[key]] ?? "").toString().trim() : "");
  const cell = (k) => (k ? (row[k] ?? "").toString().trim() : "");
  const num = S("num");
  const tipo = S("tipo");
  const vara = [S("vara"), S("comarca")].filter(Boolean).join(" — ");

  const clientCols = cols.clientCols || cols.nameCols || [];
  const oppCols = cols.oppCols || [];
  // nome da parte do SEU cliente que aparece na planilha (primeira coluna preenchida)
  const parteNome = clientCols.map(cell).find(Boolean) || "";
  // parte(s) contrária(s)
  const contraria = oppCols.map(cell).filter(Boolean).join(" / ");

  const nome =
    [tipo, client ? client.nome : parteNome].filter(Boolean).join(" — ") ||
    (num ? "Processo " + num : "Processo importado");

  const used = new Set([cols.num, cols.grau, cols.tipo, cols.vara, cols.comarca, cols.tribunal, cols.valor, cols.fase, ...(cols.nameCols || [])].filter(Boolean));
  const extras = Object.keys(row)
    .filter((k) => !used.has(k) && (row[k] ?? "").toString().trim() !== "")
    .map((k) => `${k}: ${row[k]}`);
  // Guarda SEMPRE as partes lidas da planilha, para conferência (nunca se perde).
  if (parteNome) extras.unshift("Parte (cliente): " + parteNome);
  if (contraria) extras.unshift("Parte contrária: " + contraria);

  return {
    num, nome, tipo,
    vara,
    tribunal: S("tribunal"),
    partes: contraria || null,
    fase: S("fase"),
    valor: parseValorP(S("valor")),
    grau: inferGrau(row, cols),
    obs: extras.length ? extras.join(" | ") : null,
  };
}

// Extrai processos de TEXTO livre (PDF/foto/txt): acha números CNJ e casa com
// o cliente cujo nome aparece por perto, ou por número de 1º grau já existente.
export function extractProcessesFromText(text, clients, processes) {
  const cnj = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  const known = (processes || []).slice();
  const found = [];
  const seen = new Set();
  const lines = (text || "").split(/\n+/);
  for (const line of lines) {
    const nums = line.match(cnj);
    if (!nums) continue;
    const ln = normH(line);
    for (const num of nums) {
      if (seen.has(num)) continue;
      seen.add(num);
      let client = null;
      for (const c of clients) { const cn = normH(c.nome); if (cn.length >= 4 && ln.includes(cn)) { client = c; break; } }
      if (!client) {
        const d = num.replace(/\D/g, "");
        const pr = known.find((p) => p.client_id && normH(p.num).replace(/\D/g, "") === d);
        if (pr) client = clients.find((x) => x.id === pr.client_id);
      }
      const grau = /2[º°ao]?\s*grau|c[aâ]mara|turma|\btj|\btrf|\btrt|\bstj|\bstf|apela|agravo|recurs/.test(ln) ? "2" : "1";
      found.push({ num, client, grau, contexto: line.trim().slice(0, 240) });
      if (client) known.push({ num, client_id: client.id });
    }
  }
  return found;
}

// CSV simples (detecta separador , ou ;) — para quem exporta como CSV.
export function parseCSV(text) {
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = t.slice(0, t.indexOf("\n") >= 0 ? t.indexOf("\n") : t.length);
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let field = "", record = [], inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { record.push(field); field = ""; }
    else if (c === "\n") { record.push(field); rows.push(record); record = []; field = ""; }
    else field += c;
  }
  if (field !== "" || record.length) { record.push(field); rows.push(record); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((v) => (v ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}
