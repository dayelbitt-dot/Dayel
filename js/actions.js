// ================================================================
//  FILA DE AÇÕES OFFLINE
// ----------------------------------------------------------------
//  Ações que dependem de internet (enviar WhatsApp, e-mail, abrir
//  um link, compartilhar…) não travam quando você está offline:
//  o app oferece DEIXAR PROGRAMADO para executar quando a conexão
//  voltar. As ações programadas ficam guardadas no banco local e
//  são executadas com UM toque (as janelas de WhatsApp/e-mail só
//  abrem a partir de um gesto do usuário — por isso não disparamos
//  sozinhos: mostramos a lista para você tocar em "Executar").
// ================================================================

import { getMeta, setMeta, nowISO } from "./local.js";

const KEY = "actionQueue";
let cache = null;
const listeners = new Set();

async function load() { if (!cache) cache = (await getMeta(KEY)) || []; return cache; }
async function persist() { await setMeta(KEY, cache); emit(); }
function emit() {
  const n = cache ? cache.length : 0;
  listeners.forEach((cb) => { try { cb(n); } catch {} });
  try { window.dispatchEvent(new CustomEvent("assist:actions", { detail: n })); } catch {}
}

const genId = () => { try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {} return "act-" + Math.random().toString(36).slice(2); };

export function onActions(cb) { listeners.add(cb); load().then((a) => cb(a.length)); return () => listeners.delete(cb); }
export async function actionsCount() { return (await load()).length; }
export async function listActions() { return (await load()).slice().reverse(); } // mais recentes primeiro

// Programa uma ação para quando a internet voltar.
//   action = { kind, label, phone?, text?, email?, subject?, body?, url? }
export async function scheduleAction(action) {
  await load();
  const item = { id: genId(), createdAt: nowISO(), ...action };
  cache.push(item);
  await persist();
  return item;
}

export async function removeAction(id) { await load(); cache = cache.filter((a) => a.id !== id); await persist(); }
export async function clearActions() { cache = []; await persist(); }

// Rótulos amigáveis e resumo de cada tipo de ação.
export const ACTION_META = {
  whatsapp: { label: "WhatsApp", icon: "💬" },
  email:    { label: "E-mail",   icon: "✉️" },
  url:      { label: "Abrir link", icon: "🔗" },
};
export function actionSummary(a) {
  if (a.kind === "whatsapp") return "WhatsApp para +" + (a.phone || "") + (a.text ? " — " + a.text.slice(0, 60) : "");
  if (a.kind === "email") return "E-mail para " + (a.email || "") + (a.subject ? " — " + a.subject.slice(0, 60) : "");
  if (a.kind === "url") return "Abrir " + (a.url || "");
  return a.label || a.kind;
}

// Executa a ação AGORA (precisa de gesto do usuário e de internet).
export function runAction(a) {
  switch (a.kind) {
    case "whatsapp": {
      const msg = a.text ? "?text=" + encodeURIComponent(a.text) : "";
      window.open(`https://wa.me/${a.phone || ""}${msg}`, "_blank", "noopener");
      break;
    }
    case "email": {
      const params = [
        a.subject ? "subject=" + encodeURIComponent(a.subject) : "",
        a.body ? "body=" + encodeURIComponent(a.body) : "",
      ].filter(Boolean).join("&");
      window.open(`mailto:${a.email || ""}${params ? "?" + params : ""}`, "_self");
      break;
    }
    case "url":
    default:
      if (a.url) window.open(a.url, "_blank", "noopener");
  }
}
