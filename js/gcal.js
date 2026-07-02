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

// interactive=false tenta reconectar em silêncio (se já autorizou antes)
export async function connect(interactive = true) {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google não configurado");
  await loadGIS();
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + ((resp.expires_in ? resp.expires_in * 1000 : 3600000) - 60000);
        localStorage.setItem("gcal_linked", "1");
        resolve(true);
      },
    });
    try { tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" }); }
    catch (e) { reject(e); }
  });
}

export function disconnect() {
  try { if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
  accessToken = null; tokenExpiry = 0;
  localStorage.removeItem("gcal_linked");
}

async function api(path, opts = {}) {
  const res = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
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
