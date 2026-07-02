// Integração com o Google Agenda (client-side, via Google Identity Services).
// Mostra e cria eventos usando um token de acesso obtido no navegador.
// Precisa do GOOGLE_CLIENT_ID configurado (config.js).

import { GOOGLE_CLIENT_ID } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"; } catch { return "America/Sao_Paulo"; } })();

let gisLoaded = false;
let accessToken = null;
let tokenExpiry = 0;

export const googleEnabled = () => Boolean(GOOGLE_CLIENT_ID);
export const isConnected = () => Boolean(accessToken) && Date.now() < tokenExpiry;
export const wasLinked = () => localStorage.getItem("gcal_linked") === "1";

function loadGIS() {
  return new Promise((resolve, reject) => {
    if (gisLoaded && window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Falha ao carregar o Google (verifique a internet)"));
    document.head.append(s);
  });
}

function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error("timeout: " + (what || ""))), ms))]);
}

// interactive=false tenta reconectar em silêncio (se já autorizou antes)
export async function connect(interactive = true) {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google não configurado");
  await withTimeout(loadGIS(), 10000, "carregar Google");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    let tokenClient;
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) { finish(reject, new Error(resp.error)); return; }
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + ((resp.expires_in ? resp.expires_in * 1000 : 3600000) - 60000);
          localStorage.setItem("gcal_linked", "1");
          finish(resolve, true);
        },
        // chamado quando NÃO dá para obter o token (ex: silencioso falhou) — antes ficava travado
        error_callback: (err) => { finish(reject, new Error(err?.type || "google_error")); },
      });
    } catch (e) { finish(reject, e); return; }
    // rede de segurança: nunca deixa a promessa pendurada
    setTimeout(() => finish(reject, new Error("timeout")), interactive ? 120000 : 8000);
    try { tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" }); }
    catch (e) { finish(reject, e); }
  });
}

// Mantém o Google conectado sozinho: renova o token ANTES de expirar e
// também quando o app volta a ficar visível. Assim você conecta uma vez e
// não precisa clicar em "Conectar" de novo. Não abre pop-up (prompt:'none').
let keepAliveStarted = false;
let lastSilentAt = 0;
export function startAutoConnect(onChange) {
  if (!GOOGLE_CLIENT_ID) return;
  const notify = () => { try { onChange && onChange(isConnected()); } catch {} };

  const trySilent = async (force) => {
    if (!wasLinked()) return;
    // token ainda válido por mais de 5 min? não precisa renovar (a não ser forçado)
    if (!force && isConnected() && Date.now() < tokenExpiry - 5 * 60 * 1000) return;
    if (Date.now() - lastSilentAt < 15000) return; // evita repetir demais
    lastSilentAt = Date.now();
    const was = isConnected();
    try { await connect(false); } catch {}
    if (isConnected() !== was) notify();
  };

  if (keepAliveStarted) return;
  keepAliveStarted = true;
  trySilent(true);                                   // tenta assim que o app abre
  setInterval(() => trySilent(false), 4 * 60 * 1000); // renova ~5 min antes de expirar
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") trySilent(false); });
  window.addEventListener("focus", () => trySilent(false));
  window.addEventListener("online", () => trySilent(true));
}

export function disconnect() {
  try { if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
  accessToken = null; tokenExpiry = 0;
  localStorage.removeItem("gcal_linked");
}

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch("https://www.googleapis.com/calendar/v3" + path, {
      ...opts, signal: ctrl.signal,
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } finally { clearTimeout(timer); }
  if (res.status === 401) { accessToken = null; tokenExpiry = 0; throw new Error("Sessão do Google expirou — reconecte."); }
  if (!res.ok) throw new Error("Google " + res.status + ": " + (await res.text()).slice(0, 140));
  return res.status === 204 ? null : res.json();
}

// Lista eventos entre duas datas (ISO). Retorna itens normalizados.
export async function listEvents(timeMinISO, timeMaxISO) {
  if (!isConnected()) return [];
  const params = new URLSearchParams({ timeMin: timeMinISO, timeMax: timeMaxISO, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const data = await api("/calendars/primary/events?" + params.toString());
  return (data.items || []).map(mapEvent).filter((e) => e.date);
}

export function mapEvent(e) {
  const startDate = e.start?.date || (e.start?.dateTime ? e.start.dateTime.slice(0, 10) : null);
  const startTime = e.start?.dateTime ? e.start.dateTime.slice(11, 16) : null;
  const endTime = e.end?.dateTime ? e.end.dateTime.slice(11, 16) : null;
  return { id: e.id, title: e.summary || "(sem título)", date: startDate, time: startTime, endTime, location: e.location || "", htmlLink: e.htmlLink };
}

export function addHour(dateISO, timeHHMM) {
  const d = new Date(`${dateISO}T${timeHHMM}:00`);
  d.setHours(d.getHours() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Cria um evento no Google Agenda.
export async function createEvent({ title, date, time, description }) {
  if (!isConnected()) throw new Error("Conecte o Google primeiro.");
  let body;
  if (time) {
    body = { summary: title, description: description || "", start: { dateTime: `${date}T${time}:00`, timeZone: TZ }, end: { dateTime: addHour(date, time), timeZone: TZ } };
  } else {
    body = { summary: title, description: description || "", start: { date }, end: { date } };
  }
  return api("/calendars/primary/events", { method: "POST", body: JSON.stringify(body) });
}
