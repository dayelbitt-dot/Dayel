// ================================================================
//  CAMADA DE DADOS — OFFLINE-FIRST
// ----------------------------------------------------------------
//  A Supabase continua sendo o backend principal (online). Este
//  módulo põe UM BANCO LOCAL na frente dela (js/local.js):
//
//   • LEITURA  → sempre serve do espelho local (instantâneo e
//                funciona sem internet). Havendo conexão, baixa a
//                versão fresca da nuvem e atualiza o espelho.
//   • ESCRITA  → grava JÁ no espelho local e entra na FILA DE
//                SINCRONIZAÇÃO ("pendente de sincronização"). Se
//                houver internet, sobe na hora; senão, sobe sozinho
//                quando a conexão voltar.
//
//  A interface pública (list/insert/update/remove) é a MESMA de
//  antes — o resto do app não muda. Novidades: syncNow(), o estado
//  de conexão (getStatus/onStatus) e a contagem de pendências.
// ================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./config.js";
import {
  localRows, saveRow, deleteRow, replaceTable,
  enqueue, queueItems, dequeue, updateQueueItem,
  logChange, getMeta, setMeta, wipeLocal, nowISO,
} from "./local.js";

let sb = null;
let currentUser = null; // { id, email } — usado para carimbar user_id offline

// ---- Tabelas suportadas ----
const TABLES = ["tasks", "notes", "reminders", "clients", "processes", "contacts"];

// ================================================================
//  Inicialização
// ================================================================
export async function initSupabase() {
  if (!CLOUD_ENABLED) return null;
  const cdns = [
    "https://esm.sh/@supabase/supabase-js@2",
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    "https://cdn.skypack.dev/@supabase/supabase-js@2",
  ];
  let createClient, lastErr;
  for (const url of cdns) {
    try { ({ createClient } = await import(url)); break; }
    catch (e) { lastErr = e; }
  }
  if (!createClient) throw lastErr || new Error("Falha ao carregar o Supabase");
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return sb;
}

export function client() { return sb; }
export const isCloud = () => CLOUD_ENABLED;

// Carrega o snapshot do usuário do banco local (para funcionar offline) e,
// havendo Supabase + internet, atualiza-o. Chamado no boot.
export async function initLocalData() {
  currentUser = (await getMeta("user")) || currentUser;
  await migrateLegacyLocal();
  if (sb) refreshUser().catch(() => {});
  updatePending();
}

async function refreshUser() {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user) { currentUser = { id: data.user.id, email: data.user.email }; await setMeta("user", currentUser); }
  } catch { /* offline: mantém o snapshot */ }
}
export function setSessionUser(u) {
  if (!u) return;
  currentUser = { id: u.id, email: u.email };
  setMeta("user", currentUser).catch(() => {});
}
export function getSessionUser() { return currentUser; }

// Migração única: dados antigos do "modo local" (localStorage assist:<tabela>)
// passam a viver no novo espelho offline, para ninguém perder cadastro.
async function migrateLegacyLocal() {
  if (await getMeta("legacyMigrated")) return;
  try {
    for (const t of TABLES) {
      const raw = localStorage.getItem(`assist:${t}`);
      if (!raw) continue;
      const rows = JSON.parse(raw) || [];
      for (const r of rows) await saveRow(t, { ...r, _sync: "pending" });
      if (rows.length) for (const r of rows) await enqueueOp("insert", t, r.id);
    }
  } catch { /* nada crítico */ }
  await setMeta("legacyMigrated", true);
}

// ================================================================
//  Estado de conexão / sincronização (para o selo visual)
// ================================================================
const status = { online: navigator.onLine, syncing: false, pending: 0, error: false };
const statusListeners = new Set();

export function getStatus() { return { ...status }; }
export function onStatus(cb) { statusListeners.add(cb); cb(getStatus()); return () => statusListeners.delete(cb); }
function emitStatus() {
  const snap = getStatus();
  statusListeners.forEach((cb) => { try { cb(snap); } catch {} });
  try { window.dispatchEvent(new CustomEvent("assist:status", { detail: snap })); } catch {}
}
async function updatePending() {
  status.pending = (await queueItems()).length;
  emitStatus();
}
export function setOnline(v) {
  const was = status.online;
  status.online = !!v;
  if (status.online && !was) syncNow().catch(() => {});
  emitStatus();
}

// ================================================================
//  Utilidades
// ================================================================
const genId = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  // Fallback em formato UUID v4 (a coluna id é uuid no Postgres).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Remove os campos internos (_key/_sync/_pending…) antes de subir à nuvem.
function cleanPayload(rec) {
  const o = {};
  for (const [k, v] of Object.entries(rec)) if (!k.startsWith("_")) o[k] = v;
  if (currentUser?.id && o.user_id == null) o.user_id = currentUser.id;
  return o;
}

// Falha de rede (offline no meio do caminho) x erro real do banco.
function isNetworkError(e) {
  if (!navigator.onLine) return true;
  const m = ((e && (e.message || e.code || e.toString())) || "").toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("failed to");
}

// ================================================================
//  FILA DE SINCRONIZAÇÃO — enfileira 1 operação por registro,
//  reconciliando com o que já estava pendente.
// ================================================================
async function enqueueOp(op, table, id) {
  const items = await queueItems();
  const existing = items.find((i) => i.table === table && i.id === id);
  if (!existing) { await enqueue({ op, table, id }); await updatePending(); return; }

  if (existing.op === "insert") {
    // Registro ainda nem subiu. Editar → continua "insert"; apagar → cancela tudo.
    if (op === "remove") { await dequeue(existing.seq); await updatePending(); return; }
  } else if (existing.op === "update" && op === "remove") {
    existing.op = "remove";
  }
  // Uma alteração nova dá nova chance a um item que havia falhado.
  existing.error = null; existing.tries = 0;
  await updateQueueItem(existing);
  await updatePending();
}

// ================================================================
//  LEITURA
// ================================================================
export async function list(table, { orderBy = "created_at", asc = false } = {}) {
  // Sempre que possível, baixa o fresco da nuvem e concilia com o local.
  if (sb && status.online) {
    try {
      const { data, error } = await sb.from(table).select("*").order(orderBy, { ascending: asc });
      if (error) throw error;
      const merged = await reconcile(table, data || []);
      return sortRows(merged, orderBy, asc);
    } catch (e) {
      if (!isNetworkError(e)) console.warn("list(" + table + ") caiu para o local:", e?.message || e);
      // cai para o espelho local
    }
  }
  return sortRows(await localRows(table), orderBy, asc);
}

// Concilia a versão da nuvem com o espelho local, preservando as alterações
// locais ainda NÃO sincronizadas (a mais recente do usuário vence até subir).
async function reconcile(table, serverRows) {
  const pending = (await queueItems()).filter((i) => i.table === table);
  const pendingById = new Map(pending.map((i) => [i.id, i]));
  const local = await localRows(table);
  const localById = new Map(local.map((r) => [r.id, r]));
  const serverIds = new Set(serverRows.map((r) => r.id));
  const out = [];

  for (const srv of serverRows) {
    const op = pendingById.get(srv.id);
    if (op && op.op === "remove") continue;                 // exclusão pendente: esconde
    if (op) out.push({ ...(localById.get(srv.id) || srv), _sync: "pending" }); // edição local vence
    else out.push({ ...srv, _sync: "synced" });
  }
  // Cadastros criados offline que ainda não existem na nuvem.
  for (const op of pending) {
    if (op.op === "insert" && !serverIds.has(op.id) && localById.has(op.id))
      out.push({ ...localById.get(op.id), _sync: "pending" });
  }
  await replaceTable(table, out);
  return out;
}

function sortRows(rows, orderBy, asc) {
  return rows.slice().sort((a, b) => {
    const av = a[orderBy] ?? "", bv = b[orderBy] ?? "";
    if (av === bv) return 0;
    return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
}

// ================================================================
//  ESCRITA (grava local + fila; sobe quando dá)
// ================================================================
export async function insert(table, row) {
  const record = {
    id: row.id || genId(),
    created_at: row.created_at || nowISO(),
    ...row,
    ...(currentUser?.id ? { user_id: currentUser.id } : {}),
    _sync: "pending",
  };
  await saveRow(table, record);
  await enqueueOp("insert", table, record.id);
  await logChange({ op: "insert", table, id: record.id });
  flushSoon();
  return stripSync(record);
}

export async function update(table, id, patch) {
  const local = await localRows(table);
  const current = local.find((r) => r.id === id) || { id };
  const record = { ...current, ...patch, _sync: "pending" };
  await saveRow(table, record);
  await enqueueOp("update", table, id);
  await logChange({ op: "update", table, id });
  flushSoon();
  return stripSync(record);
}

export async function remove(table, id) {
  await deleteRow(table, id);
  await enqueueOp("remove", table, id);
  await logChange({ op: "remove", table, id });
  flushSoon();
}

function stripSync(rec) { const { _sync, _pending, ...rest } = rec; return rest; }

// ================================================================
//  SINCRONIZAÇÃO com a Supabase
// ================================================================
let flushing = false;

function flushSoon() { if (sb && status.online) syncNow().catch(() => {}); }

export async function syncNow() {
  if (flushing || !sb || !status.online) return;
  const items = await queueItems();
  if (!items.length) { status.error = false; emitStatus(); return; }

  flushing = true; status.syncing = true; status.error = false; emitStatus();
  let hadError = false, offlineBreak = false;
  try {
    // Esvazia a fila por completo (inclusive itens criados DURANTE o envio).
    // Só reenvia itens ainda com erro se ganharam uma edição nova (tries volta a 0).
    let batch, guard = 0;
    while (status.online && (batch = await queueItems()).length && guard++ < 50) {
      const todo = batch.filter((i) => !i.error || i.tries === 0);
      if (!todo.length) break; // sobraram só itens já marcados com erro real
      for (const item of todo) {
        try {
          await pushItem(item);
          await dequeue(item.seq);
        } catch (e) {
          if (isNetworkError(e)) { offlineBreak = true; break; }
          hadError = true;
          item.tries = (item.tries || 0) + 1;
          item.error = e?.message || String(e);
          await updateQueueItem(item);
          await markRowError(item.table, item.id);
        }
      }
      if (offlineBreak) break;
    }
    // Baixa o que outros aparelhos mudaram (sincronização bidirecional).
    if (status.online && !offlineBreak) { for (const t of TABLES) { try { await pull(t); } catch {} } }
  } finally {
    flushing = false; status.syncing = false; status.error = hadError;
    await updatePending();
  }
}

async function pushItem(item) {
  const { op, table, id } = item;
  if (op === "remove") {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const rows = await localRows(table);
  const rec = rows.find((r) => r.id === id);
  if (!rec) return; // sumiu do espelho (apagado depois): nada a subir
  const payload = cleanPayload({ ...rec, id });
  const { data, error } = await sb.from(table).upsert(payload).select().single();
  if (error) throw error;
  if (data) await saveRow(table, { ...data, _sync: "synced" }); // guarda a versão confirmada
}

async function pull(table) {
  const { data, error } = await sb.from(table).select("*");
  if (error) throw error;
  await reconcile(table, data || []);
}

async function markRowError(table, id) {
  const rows = await localRows(table);
  const rec = rows.find((r) => r.id === id);
  if (rec) await saveRow(table, { ...rec, _sync: "error" });
}

// Nº de itens aguardando sincronização.
export async function pendingCount() { return (await queueItems()).length; }

// Limpa o banco local (logout / "apagar dados deste aparelho").
export async function clearLocal() { await wipeLocal(); currentUser = null; await updatePending(); }

export { TABLES };
