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

// A partir dos nomes das colunas, descobre qual é cada campo.
export function detectColumns(keys) {
  const find = (re) => keys.find((k) => re.test(normH(k)));
  return {
    num: find(/processo|numero|n[º°]|cnj|autos/),
    grau: find(/grau|instancia/),
    tipo: find(/tipo|acao|classe|assunto|natureza/),
    vara: find(/vara|juizo/),
    comarca: find(/comarca|foro/),
    tribunal: find(/tribunal|orgao|camara|turma/),
    valor: find(/valor/),
    fase: find(/fase|situacao|status/),
    nameCols: keys.filter((k) =>
      /cliente|parte|autor|re[uú]|requerente|requerido|exequente|executado|nome|adverso|apelante|apelad|agravante|agravad|recorrente|recorrid/.test(normH(k))
    ),
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

// Casa a linha com um cliente já cadastrado: primeiro pelo nome que aparece
// nas colunas de partes; senão, pelo número de um processo de 1º grau já existente.
export function matchClient(row, cols, clients, processes) {
  for (const nc of cols.nameCols) {
    const cell = normH(row[nc]);
    if (!cell) continue;
    for (const c of clients) {
      const cn = normH(c.nome);
      if (cn.length >= 4 && cell.includes(cn)) return { client: c, how: "nome" };
    }
  }
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
  const num = S("num");
  const tipo = S("tipo");
  const vara = [S("vara"), S("comarca")].filter(Boolean).join(" — ");
  const parteNome = cols.nameCols[0] ? (row[cols.nameCols[0]] ?? "").toString().trim() : "";
  const nome =
    [tipo, client ? client.nome : parteNome].filter(Boolean).join(" — ") ||
    (num ? "Processo " + num : "Processo importado");

  const used = new Set([cols.num, cols.grau, cols.tipo, cols.vara, cols.comarca, cols.tribunal, cols.valor, cols.fase, ...cols.nameCols].filter(Boolean));
  const extras = Object.keys(row)
    .filter((k) => !used.has(k) && (row[k] ?? "").toString().trim() !== "")
    .map((k) => `${k}: ${row[k]}`);

  return {
    num, nome, tipo,
    vara,
    tribunal: S("tribunal"),
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
