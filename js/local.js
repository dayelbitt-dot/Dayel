// ================================================================
//  BANCO DE DADOS LOCAL (módulo offline)
// ----------------------------------------------------------------
//  Guarda no próprio aparelho os dados essenciais para o app
//  funcionar SEM internet: um espelho das tabelas (clientes,
//  processos, tarefas, agenda, notas…), a FILA DE SINCRONIZAÇÃO
//  (alterações feitas offline, aguardando subir para a Supabase) e
//  um LOG DE ALTERAÇÕES (histórico local).
//
//  Usa IndexedDB (aguenta anexos/PDFs grandes). Se o navegador não
//  tiver IndexedDB (aba privada antiga etc.), cai para localStorage
//  automaticamente — a mesma interface assíncrona continua valendo.
// ================================================================

const DB_NAME = "assist-offline";
const DB_VERSION = 1;
// rows      → espelho das tabelas (uma linha por registro)
// outbox    → fila de alterações pendentes de sincronização
// changelog → histórico local de alterações (logs de alteração)
// meta      → cantinho chave→valor (snapshot da sessão, etc.)
const STORES = ["rows", "outbox", "changelog", "meta"];

// ---------------------------------------------------------------
//  Abertura do IndexedDB (com detecção de indisponibilidade)
// ---------------------------------------------------------------
let dbPromise = null;
let idbBroken = false;

function openDB() {
  if (idbBroken) return Promise.reject(new Error("idb-unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === "undefined") throw new Error("no-indexeddb");
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) { idbBroken = true; reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("rows"))
        db.createObjectStore("rows", { keyPath: "_key" });
      if (!db.objectStoreNames.contains("outbox"))
        db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("changelog"))
        db.createObjectStore("changelog", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("meta"))
        db.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { idbBroken = true; reject(req.error); };
  });
  return dbPromise;
}

// ---------------------------------------------------------------
//  Fallback em localStorage (quando não há IndexedDB)
// ---------------------------------------------------------------
const LS = {
  key: (store) => `assist:offline:${store}`,
  read(store) {
    try { return JSON.parse(localStorage.getItem(this.key(store))) || []; }
    catch { return []; }
  },
  write(store, arr) {
    try { localStorage.setItem(this.key(store), JSON.stringify(arr)); }
    catch { /* cota estourada: dados grandes não cabem no fallback — ignora */ }
  },
  keyOf(store, rec) {
    if (store === "rows") return rec._key;
    if (store === "meta") return rec.k;
    return rec.seq;
  },
};
let lsSeq = Number(localStorage.getItem("assist:offline:seq") || 0);
const nextLsSeq = () => { lsSeq += 1; localStorage.setItem("assist:offline:seq", String(lsSeq)); return lsSeq; };

// ---------------------------------------------------------------
//  Primitivas assíncronas: getAll / get / put / del / clear
//  (IndexedDB quando disponível; localStorage como plano B)
// ---------------------------------------------------------------
function idbGetAll(store) {
  return openDB().then((db) => new Promise((res, rej) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  }));
}
function idbGet(store, key) {
  return openDB().then((db) => new Promise((res, rej) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}
function idbPut(store, value) {
  return openDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => { value.seq = value.seq ?? req.result; };
    tx.oncomplete = () => res(value);
    tx.onerror = () => rej(tx.error);
  }));
}
function idbDel(store, key) {
  return openDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}
function idbClear(store) {
  return openDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}

async function getAll(store) {
  try { return await idbGetAll(store); }
  catch { return LS.read(store); }
}
async function put(store, value) {
  try { return await idbPut(store, value); }
  catch {
    const arr = LS.read(store);
    if ((store === "outbox" || store === "changelog") && value.seq == null) value.seq = nextLsSeq();
    const k = LS.keyOf(store, value);
    const i = arr.findIndex((r) => LS.keyOf(store, r) === k);
    if (i >= 0) arr[i] = value; else arr.push(value);
    LS.write(store, arr);
    return value;
  }
}
async function del(store, key) {
  try { await idbDel(store, key); }
  catch { LS.write(store, LS.read(store).filter((r) => LS.keyOf(store, r) !== key)); }
}

// ---------------------------------------------------------------
//  ESPELHO DAS TABELAS (rows)
// ---------------------------------------------------------------
const rowKey = (table, id) => `${table}::${id}`;

function stripMeta(rec) {
  // Devolve o registro "limpo" para o app, preservando os marcadores de
  // sincronização (_pending / _sync) que a interface usa para o selo visual.
  const { _key, _table, ...rest } = rec;
  return rest;
}

// Lê todas as linhas de UMA tabela do espelho local.
export async function localRows(table) {
  const all = await getAll("rows");
  return all.filter((r) => r._table === table).map(stripMeta);
}

// Substitui/insere UM registro no espelho.
export async function saveRow(table, record) {
  const value = { ...record, _key: rowKey(table, record.id), _table: table };
  await put("rows", value);
  return stripMeta(value);
}

// Remove UM registro do espelho.
export async function deleteRow(table, id) {
  await del("rows", rowKey(table, id));
}

// Substitui TODAS as linhas de uma tabela (usado ao baixar da nuvem).
export async function replaceTable(table, records) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction("rows", "readwrite");
      const os = tx.objectStore("rows");
      const all = os.getAll();
      all.onsuccess = () => {
        for (const r of all.result || []) if (r._table === table) os.delete(r._key);
        for (const rec of records) os.put({ ...rec, _key: rowKey(table, rec.id), _table: table });
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    const others = LS.read("rows").filter((r) => r._table !== table);
    for (const rec of records) others.push({ ...rec, _key: rowKey(table, rec.id), _table: table });
    LS.write("rows", others);
  }
}

// ---------------------------------------------------------------
//  FILA DE SINCRONIZAÇÃO (outbox)
// ---------------------------------------------------------------
// Cada item: { seq, op:'insert'|'update'|'remove', table, id, payload, ts, tries, error }
export async function enqueue(op) {
  return put("outbox", { ...op, ts: op.ts || nowISO(), tries: 0 });
}
export async function queueItems() {
  const arr = await getAll("outbox");
  return arr.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
export async function dequeue(seq) { return del("outbox", seq); }
export async function updateQueueItem(item) { return put("outbox", item); }

// ---------------------------------------------------------------
//  LOG DE ALTERAÇÕES (changelog) — histórico local
// ---------------------------------------------------------------
export async function logChange(entry) {
  return put("changelog", { ...entry, ts: entry.ts || nowISO() });
}
export async function changelog(limit = 200) {
  const arr = await getAll("changelog");
  return arr.sort((a, b) => (b.seq || 0) - (a.seq || 0)).slice(0, limit);
}

// ---------------------------------------------------------------
//  META (snapshot da sessão, marcações diversas)
// ---------------------------------------------------------------
export async function getMeta(k) {
  try { const rec = await idbGet("meta", k); return rec ? rec.v : null; }
  catch { const rec = LS.read("meta").find((r) => r.k === k); return rec ? rec.v : null; }
}
export async function setMeta(k, v) { return put("meta", { k, v }); }

// Apaga TUDO do banco local (logout / "apagar dados locais deste aparelho").
export async function wipeLocal() {
  for (const store of STORES) {
    try { await idbClear(store); }
    catch { LS.write(store, []); }
  }
}

// ---------------------------------------------------------------
export function nowISO() {
  // ISO do horário local do aparelho (sem depender de relógio externo).
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
}
