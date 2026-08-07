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
  localRows, localRowsDetailed, saveRow, deleteRow, replaceTable,
  enqueue, queueItems, dequeue, updateQueueItem,
  logChange, getMeta, setMeta, wipeLocal, nowISO,
  dumpRows, rawDump, loadRows, requestPersistence,
} from "./local.js";
import { securityEnabled, unlocked, provisionConfig, unlock, clearConfig } from "./security.js";

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
  // Tira o banco local da fila de descarte automático do navegador ANTES de
  // qualquer outra coisa (ver requestPersistence em local.js).
  requestPersistence().catch(() => {});
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
// Proteção local ligada mas travada: nenhum dado deve ser lido/escrito/cifrado.
const locked = () => securityEnabled() && !unlocked();

// Baixa a tabela INTEIRA da nuvem, em páginas. O PostgREST corta a resposta em
// um número máximo de linhas (1.000 por padrão na Supabase) sem avisar que
// cortou — quem pedisse ".select('*')" e confiasse no resultado achava que a
// nuvem só tinha as primeiras 1.000 linhas.
const PAGE = 1000;
async function fetchAllRows(table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    // Ordena por id (único) só para paginar: sem uma ordem ESTÁVEL, o banco
    // pode devolver a mesma linha em duas páginas e deixar outra de fora. A
    // ordem que a tela usa é aplicada depois, aqui mesmo, por sortRows.
    const { data, error } = await sb.from(table).select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function list(table, { orderBy = "created_at", asc = false } = {}) {
  if (locked()) return []; // app fica atrás da tela de bloqueio; salvaguarda
  // Sempre que possível, baixa o fresco da nuvem e concilia com o local.
  if (sb && status.online) {
    try {
      const data = await fetchAllRows(table);
      const merged = await reconcile(table, data);
      return sortRows(merged, orderBy, asc);
    } catch (e) {
      if (!isNetworkError(e)) console.warn("list(" + table + ") caiu para o local:", e?.message || e);
      // cai para o espelho local
    }
  }
  return sortRows(await localRows(table), orderBy, asc);
}

// ----------------------------------------------------------------
//  CONCILIAÇÃO nuvem × aparelho
// ----------------------------------------------------------------
//  Regra de ouro: a nuvem NÃO manda apagar por omissão. Um registro que existe
//  aqui e não veio na resposta pode ter sido apagado em outro aparelho — mas
//  pode também nunca ter subido, ou a resposta pode ter vindo capenga (sessão
//  expirada, RLS de outra conta, corte de paginação). Só apagamos do aparelho
//  o registro que JÁ ESTEVE confirmado na nuvem (_sync: "synced") e sumiu de
//  lá. Todo o resto fica — e volta para a fila para subir.
async function reconcile(table, serverRows) {
  const pending = (await queueItems()).filter((i) => i.table === table);
  const pendingById = new Map(pending.map((i) => [i.id, i]));
  const { rows: local, unreadable } = await localRowsDetailed(table);
  const localById = new Map(local.map((r) => [r.id, r]));
  const serverIds = new Set(serverRows.map((r) => r.id));

  // Registros cifrados que não conseguimos abrir: não sabemos o que há aqui,
  // então não regravamos o espelho. Serve o que dá para ler e não apaga nada.
  if (unreadable) {
    console.warn(`reconcile(${table}): ${unreadable} registro(s) ilegíveis — espelho preservado.`);
    return local;
  }

  // Resposta vazia com dados aqui é suspeita (sessão expirada, conta trocada,
  // RLS): a nuvem não "esvaziou", ela não respondeu direito. Nesse caso ninguém
  // é apagado — nem o que já estava confirmado lá.
  const suspeita = !serverRows.length && local.length > 0;
  if (suspeita) console.warn(`reconcile(${table}): nuvem devolveu 0 linhas com ${local.length} aqui — nada será apagado.`);

  const out = [];
  for (const srv of serverRows) {
    const op = pendingById.get(srv.id);
    if (op && op.op === "remove") continue;                 // exclusão pendente: esconde
    if (op) out.push({ ...(localById.get(srv.id) || srv), _sync: "pending" }); // edição local vence
    else out.push({ ...srv, _sync: "synced" });
  }

  // O que existe SÓ aqui.
  const resgatados = [];
  for (const rec of local) {
    if (serverIds.has(rec.id)) continue;
    const op = pendingById.get(rec.id);
    if (op && op.op === "remove") continue;      // o usuário mandou apagar: sai mesmo
    // Já esteve confirmado na nuvem e agora sumiu de lá: foi apagado em outro
    // aparelho. Só aceitamos essa leitura quando a resposta é confiável.
    if (!op && rec._sync === "synced" && !suspeita) continue;
    const confirmado = rec._sync === "synced";
    out.push({ ...rec, _sync: !op && confirmado ? "synced" : "pending" });
    // Nunca chegou a ser confirmado na nuvem: reenfileira para subir.
    if (!op && !confirmado) resgatados.push(rec.id);
  }
  await replaceTable(table, out);
  for (const id of resgatados) await enqueueOp("insert", table, id);
  if (resgatados.length) console.warn(`reconcile(${table}): ${resgatados.length} registro(s) só existiam aqui — recolocados na fila de envio.`);
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
let flushing = null; // promessa da sincronização em andamento (null = parada)

function flushSoon() { if (sb && status.online) syncNow().catch(() => {}); }

export async function syncNow() {
  if (!sb || !status.online || locked()) return; // travado: não cifra/decifra em 2º plano
  // Já existe uma sincronização rodando: ESPERA por ela em vez de voltar na
  // hora. Quem escreve "await syncNow()" precisa poder confiar que, ao voltar,
  // a fila foi mesmo trabalhada — é essa garantia que o logout usa para decidir
  // se pode ou não limpar o aparelho.
  if (flushing) return flushing;
  flushing = doSync();
  try { await flushing; } finally { flushing = null; }
}

async function doSync() {
  const items = await queueItems();
  if (!items.length) { status.error = false; emitStatus(); return; }

  status.syncing = true; status.error = false; emitStatus();
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
    status.syncing = false; status.error = hadError;
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
  const { rows, unreadable } = await localRowsDetailed(table);
  const rec = rows.find((r) => r.id === id);
  if (!rec) {
    // O registro sumiu do espelho mas a ordem de subir continua na fila. Isso
    // não é normal (apagar cancela/converte o item) e antes era engolido em
    // silêncio: a fila esvaziava sem nada ter subido, e o app passava a achar
    // que estava tudo sincronizado. Agora erra alto e o item FICA na fila.
    throw new Error(
      unreadable
        ? `registro ${id} está cifrado e ilegível neste aparelho — destrave com o PIN antes de sincronizar`
        : `registro ${id} não está mais no espelho local — nada foi enviado`,
    );
  }
  const payload = cleanPayload({ ...rec, id });
  const { data, error } = await sb.from(table).upsert(payload).select().single();
  if (error) throw error;
  if (data) await saveRow(table, { ...data, _sync: "synced" }); // guarda a versão confirmada
}

async function pull(table) {
  await reconcile(table, await fetchAllRows(table));
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

// Cópia crua de TUDO o que está guardado no aparelho — inclusive registros
// ainda cifrados e a fila de envio. É o arquivo que baixamos antes de qualquer
// apagamento local, para nada ser irreversível. Pode ser aberto depois em
// recuperar.html (que decifra com o PIN, se for o caso).
export async function emergencyBackup() {
  const dump = await rawDump();
  return {
    app: "Meu Assistente",
    tipo: "backup-cru-do-aparelho",
    versao: 1,
    exportadoEm: new Date().toISOString(),
    usuario: currentUser?.email || null,
    seguranca: (() => { try { return JSON.parse(localStorage.getItem("assist:sec:cfg")) || {}; } catch { return {}; } })(),
    total: { rows: dump.rows.length, outbox: dump.outbox.length, changelog: dump.changelog.length },
    ...dump,
  };
}

// Antes de apagar o aparelho: dá para confiar que a nuvem tem tudo?
// Só responde "sim" com internet, sem nada na fila, sem erro de sincronização
// e sem registro que exista apenas aqui.
export async function cloudHasEverything() {
  if (!sb || !status.online) return { ok: false, motivo: "sem conexão com a nuvem agora" };
  if (locked()) return { ok: false, motivo: "os dados deste aparelho estão travados pelo PIN" };
  try { await syncNow(); } catch { /* avaliado abaixo pelo estado */ }
  if (status.error) return { ok: false, motivo: "a última sincronização terminou com erro" };
  const pend = await pendingCount();
  if (pend) return { ok: false, motivo: `${pend} alteração(ões) ainda não subiram` };
  for (const t of TABLES) {
    const { rows, unreadable } = await localRowsDetailed(t);
    if (unreadable) return { ok: false, motivo: `${unreadable} registro(s) ilegíveis em ${t}` };
    const soAqui = rows.filter((r) => r._sync && r._sync !== "synced").length;
    if (soAqui) return { ok: false, motivo: `${soAqui} registro(s) de ${t} ainda não confirmados na nuvem` };
  }
  return { ok: true, motivo: "" };
}

// ================================================================
//  SEGURANÇA LOCAL — liga/desliga/troca o PIN, recifrando o espelho.
//  (A leitura/escrita cifrada é transparente em local.js; aqui só
//  orquestramos a MIGRAÇÃO dos dados que já existem no aparelho.)
// ================================================================

// Ativa a proteção: cria a config para o PIN e RECIFRA tudo o que já existe.
export async function enableSecurity(pin, opts = {}) {
  if (securityEnabled()) throw new Error("A proteção já está ativa.");
  const snapshot = await dumpRows();      // dados atuais (em claro)
  await provisionConfig(pin, opts);       // agora ligado + destravado (chave na memória)
  await loadRows(snapshot);               // regrava tudo cifrado
}

// Desativa: confere o PIN, decifra tudo e regrava em texto normal.
export async function disableSecurity(pin) {
  if (!securityEnabled()) return;
  await unlock(pin);                      // valida o PIN e destrava
  const snapshot = await dumpRows();      // decifra tudo
  clearConfig();                          // desliga a proteção (chave sai da memória)
  await loadRows(snapshot);               // regrava em claro
}

// Troca o PIN: decifra com o antigo, recifra com o novo.
export async function changePin(oldPin, newPin, opts = {}) {
  if (!securityEnabled()) throw new Error("A proteção não está ativa.");
  await unlock(oldPin);                   // valida o PIN atual
  const snapshot = await dumpRows();      // decifra com a chave antiga
  await provisionConfig(newPin, opts);    // nova chave/salt/verificador na memória
  await loadRows(snapshot);               // regrava cifrado com a nova chave
}

export { TABLES };
