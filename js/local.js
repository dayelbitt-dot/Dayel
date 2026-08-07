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

import { securityEnabled, unlocked, encryptRecord, decryptRecord } from "./security.js";

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
  const { _key, _table, _iv, _ct, ...rest } = rec;
  return rest;
}

const encActive = () => securityEnabled() && unlocked();

// Monta o registro a ser gravado: cifrado (se a proteção estiver ligada e
// destravada) ou em texto normal. Mantém _key/_table em claro (só indexam).
async function toStored(table, record) {
  if (encActive()) {
    const { _iv, _ct } = await encryptRecord({ ...record });
    return { _key: rowKey(table, record.id), _table: table, _iv, _ct };
  }
  return { ...record, _key: rowKey(table, record.id), _table: table };
}
// Volta um registro guardado para objeto usável (decifra se preciso).
async function fromStored(r) {
  if (r._ct) {
    if (!unlocked()) return null;      // travado: não expõe nada
    try { return await decryptRecord(r); } catch { return null; }
  }
  return stripMeta(r);
}

// Lê todas as linhas de UMA tabela do espelho local, informando TAMBÉM quantas
// não puderam ser lidas (registros cifrados sem a chave na memória).
//
// Essa contagem é essencial: um registro ilegível não é um registro inexistente.
// Quem for SOBRESCREVER o espelho (reconcile/dumpRows) precisa saber a diferença
// para não apagar dado bom achando que ali não havia nada.
export async function localRowsDetailed(table) {
  const all = await getAll("rows");
  const rows = [];
  let unreadable = 0;
  for (const r of all) {
    if (r._table !== table) continue;
    const rec = await fromStored(r);
    if (rec) rows.push(rec);
    else unreadable += 1;
  }
  return { rows, unreadable };
}

// Lê todas as linhas de UMA tabela do espelho local.
export async function localRows(table) {
  return (await localRowsDetailed(table)).rows;
}

// Substitui/insere UM registro no espelho.
export async function saveRow(table, record) {
  await put("rows", await toStored(table, record));
  return record;
}

// Remove UM registro do espelho.
export async function deleteRow(table, id) {
  await del("rows", rowKey(table, id));
}

// Substitui TODAS as linhas de uma tabela (usado ao baixar da nuvem).
export async function replaceTable(table, records) {
  // Pré-cifra fora da transação (cripto é assíncrona; não pode aguardar dentro
  // de uma transação IndexedDB, que se fecha sozinha ao ceder o event loop).
  const prepared = [];
  for (const rec of records) prepared.push(await toStored(table, rec));
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction("rows", "readwrite");
      const os = tx.objectStore("rows");
      const all = os.getAll();
      all.onsuccess = () => {
        for (const r of all.result || []) if (r._table === table) os.delete(r._key);
        for (const value of prepared) os.put(value);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    const others = LS.read("rows").filter((r) => r._table !== table);
    for (const value of prepared) others.push(value);
    LS.write("rows", others);
  }
}

// ---- Migração de cripto (ligar/desligar/trocar PIN): despeja tudo em claro e
// regrava conforme o estado atual (cifrado ou não). Exige estar destravado
// quando os dados atuais estão cifrados. ----
export async function dumpRows() {
  const all = await getAll("rows");
  const out = [];
  let unreadable = 0;
  for (const r of all) {
    const rec = await fromStored(r);
    if (rec) out.push({ table: r._table, record: rec });
    else unreadable += 1;
  }
  // Migrar (ligar/desligar/trocar PIN) com registros ilegíveis significaria
  // regravar o espelho SEM eles — ou seja, apagá-los. Melhor abortar.
  if (unreadable) {
    throw new Error(
      `Há ${unreadable} registro(s) neste aparelho que não consegui abrir com a chave atual. ` +
      "Nada foi alterado. Use a página de recuperação (recuperar.html) antes de continuar.",
    );
  }
  return out;
}

// Cópia CRUA do espelho, exatamente como está no disco — inclusive os registros
// ainda cifrados. É o que salvamos como rede de proteção antes de apagar algo:
// mesmo ilegível agora, um dump cru volta a ser legível com o PIN certo.
export async function rawDump() {
  const [rows, outbox, changelog, meta] = await Promise.all([
    getAll("rows"), getAll("outbox"), getAll("changelog"), getAll("meta"),
  ]);
  return { rows, outbox, changelog, meta };
}

export async function clearRows() {
  try { await idbClear("rows"); } catch { LS.write("rows", []); }
}

// Regrava o espelho inteiro (usado nas migrações de cripto). Faz tudo dentro de
// UMA transação: ou o aparelho fica 100% no formato novo, ou continua como
// estava. Antes isso era "apaga tudo, depois regrava um por um" — fechar o app
// no meio da migração levava embora todo o resto.
export async function loadRows(items) {
  // A cripto é assíncrona e não pode ser aguardada dentro de uma transação
  // IndexedDB (ela se fecha ao ceder o event loop): prepara tudo antes.
  const prepared = [];
  for (const it of items) prepared.push(await toStored(it.table, it.record));
  const keep = new Set(prepared.map((r) => r._key));
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction("rows", "readwrite");
      const os = tx.objectStore("rows");
      const all = os.getAll();
      all.onsuccess = () => {
        for (const r of all.result || []) if (!keep.has(r._key)) os.delete(r._key);
        for (const value of prepared) os.put(value);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    const others = LS.read("rows").filter((r) => !keep.has(r._key));
    LS.write("rows", others.concat(prepared));
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

// ---------------------------------------------------------------
//  ARMAZENAMENTO PERSISTENTE
// ----------------------------------------------------------------
//  Por padrão o navegador considera o banco local "descartável": em aparelho
//  com pouco espaço — ou no Safari/iOS, depois de alguns dias sem abrir o site —
//  ele APAGA IndexedDB e localStorage sozinho, sem avisar. Pedir persistência
//  tira o app dessa fila de descarte. Em PWA instalado costuma ser concedido
//  sem nem perguntar.
// ---------------------------------------------------------------
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: false };
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const persisted = already || (await navigator.storage.persist());
    return { supported: true, persisted };
  } catch { return { supported: false, persisted: false }; }
}

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
