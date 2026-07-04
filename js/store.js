// Camada de dados: usa Supabase (nuvem) quando configurado,
// senão cai para localStorage (modo local). A interface é a mesma.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./config.js";

let sb = null;

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

// ---- Tabelas suportadas ----
const TABLES = ["tasks", "notes", "reminders", "clients", "processes", "contacts"];

// =================== MODO LOCAL (localStorage) ===================
const LKEY = (t) => `assist:${t}`;
const uid = () =>
  "id-" + Math.random().toString(36).slice(2) + "-" + (localCounter++);
let localCounter = 0;

function localAll(table) {
  try { return JSON.parse(localStorage.getItem(LKEY(table))) || []; }
  catch { return []; }
}
function localSave(table, rows) {
  localStorage.setItem(LKEY(table), JSON.stringify(rows));
}

// =================== API pública do store ========================

export async function list(table, { orderBy = "created_at", asc = false } = {}) {
  if (sb) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order(orderBy, { ascending: asc });
    if (error) throw error;
    return data || [];
  }
  const rows = localAll(table).slice();
  rows.sort((a, b) => {
    const av = a[orderBy] ?? "", bv = b[orderBy] ?? "";
    return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
  return rows;
}

export async function insert(table, row) {
  if (sb) {
    const { data: { user } } = await sb.auth.getUser();
    const payload = { ...row, user_id: user.id };
    const { data, error } = await sb.from(table).insert(payload).select().single();
    if (error) throw error;
    return data;
  }
  const rows = localAll(table);
  const record = { id: uid(), created_at: new Date().toISOString(), ...row };
  rows.push(record);
  localSave(table, rows);
  return record;
}

export async function update(table, id, patch) {
  if (sb) {
    const { data, error } = await sb.from(table).update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  const rows = localAll(table);
  const i = rows.findIndex((r) => r.id === id);
  if (i >= 0) { rows[i] = { ...rows[i], ...patch }; localSave(table, rows); return rows[i]; }
  return null;
}

export async function remove(table, id) {
  if (sb) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const rows = localAll(table).filter((r) => r.id !== id);
  localSave(table, rows);
}

export { TABLES };
