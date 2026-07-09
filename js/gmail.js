// Integração com o Gmail (client-side, via Google Identity Services).
// Busca e-mails de "Movimentações Processuais - EPROC" e extrai o teor da
// publicação de cada um. Usa o MESMO Client ID do Google Agenda (config.js),
// só que com o escopo de LEITURA do Gmail (gmail.readonly) — nada é enviado
// para servidores; tudo roda no navegador.
//
// ⚠️ Para funcionar, o projeto do Google Cloud (o do GOOGLE_CLIENT_ID) precisa
// ter a "Gmail API" ativada e o escopo gmail.readonly liberado na tela de
// consentimento. Passo a passo no README.

import { GOOGLE_CLIENT_ID } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Busca padrão: e-mails do EPROC com movimentações/intimações. É possível
// refinar na própria tela. IMPORTANTE: no Gmail o hífen "-" significa EXCLUIR,
// então nunca usamos "- EPROC" solto — só frases entre aspas e OR.
// Remetentes ignorados (newsletters que citam termos jurídicos mas não são
// intimações do EPROC): ConJur.
export const DEFAULT_QUERY =
  '("movimentações processuais" OR "movimentação processual" OR "intimação eletrônica" OR eproc) -from:boletim@conjur.com.br';

let gisLoaded = false;
let accessToken = null;
let tokenExpiry = 0;

// Guarda o token de acesso no aparelho enquanto for válido (~1h). Assim, reabrir
// o app dentro desse tempo já fica conectado, sem depender da reconexão
// silenciosa do Google (que costuma falhar em PWA no iPhone).
const TOKEN_KEY = "gmail_token";
function persistToken() {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiry: tokenExpiry })); } catch {}
}
function clearToken() {
  accessToken = null; tokenExpiry = 0;
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
// Recupera um token ainda válido guardado numa sessão anterior.
(function restoreToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const { token, expiry } = JSON.parse(raw);
    if (token && expiry && Date.now() < expiry) { accessToken = token; tokenExpiry = expiry; }
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
})();

export const googleEnabled = () => Boolean(GOOGLE_CLIENT_ID);
export const isConnected = () => Boolean(accessToken) && Date.now() < tokenExpiry;
export const wasLinked = () => localStorage.getItem("gmail_linked") === "1";

function loadGIS() {
  return new Promise((resolve, reject) => {
    if (gisLoaded && window.google?.accounts?.oauth2) return resolve();
    // Se o gcal.js já injetou o script, reaproveita.
    if (window.google?.accounts?.oauth2) { gisLoaded = true; return resolve(); }
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => { gisLoaded = true; resolve(); });
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar o Google (verifique a internet)")));
      if (window.google?.accounts?.oauth2) { gisLoaded = true; resolve(); }
      return;
    }
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
          localStorage.setItem("gmail_linked", "1");
          persistToken();
          finish(resolve, true);
        },
        error_callback: (err) => { finish(reject, new Error(err?.type || "google_error")); },
      });
    } catch (e) { finish(reject, e); return; }
    setTimeout(() => finish(reject, new Error("timeout")), interactive ? 120000 : 8000);
    try { tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" }); }
    catch (e) { finish(reject, e); }
  });
}

// Mantém o Gmail conectado sozinho: renova o token antes de expirar e quando o
// app volta a ficar visível. Assim você conecta uma vez e não precisa repetir.
let keepAliveStarted = false;
let lastSilentAt = 0;
export function startAutoConnect(onChange) {
  if (!GOOGLE_CLIENT_ID) return;
  const notify = () => { try { onChange && onChange(isConnected()); } catch {} };

  const trySilent = async (force) => {
    if (!wasLinked()) return;
    if (!force && isConnected() && Date.now() < tokenExpiry - 5 * 60 * 1000) return;
    if (Date.now() - lastSilentAt < 15000) return;
    lastSilentAt = Date.now();
    const was = isConnected();
    try { await connect(false); } catch {}
    if (isConnected() !== was) notify();
  };

  if (keepAliveStarted) return;
  keepAliveStarted = true;
  trySilent(true);
  setInterval(() => trySilent(false), 4 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") trySilent(false); });
  window.addEventListener("focus", () => trySilent(false));
  window.addEventListener("online", () => trySilent(true));
}

export function disconnect() {
  try { if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
  clearToken();
  localStorage.removeItem("gmail_linked");
}

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, {
      ...opts, signal: ctrl.signal,
      headers: { Authorization: "Bearer " + accessToken, ...(opts.headers || {}) },
    });
  } finally { clearTimeout(timer); }
  if (res.status === 401) { clearToken(); throw new Error("Sessão do Google expirou — reconecte."); }
  if (res.status === 403) throw new Error("Gmail sem permissão. Ative a Gmail API e o escopo de leitura (README).");
  if (!res.ok) throw new Error("Gmail " + res.status + ": " + (await res.text()).slice(0, 160));
  return res.json();
}

// ---- decodificação base64url (corpo das mensagens) ----
function decodeB64Url(data) {
  if (!data) return "";
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch { return ""; }
}

// Percorre as partes MIME e devolve o melhor texto (prefere text/plain; se só
// houver HTML, converte para texto preservando quebras de linha).
function extractBody(payload) {
  let plain = "", html = "";
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || "";
    const data = part.body?.data;
    if (mime === "text/plain" && data) plain += decodeB64Url(data) + "\n";
    else if (mime === "text/html" && data) html += decodeB64Url(data) + "\n";
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.trim()) return plain;
  if (html.trim()) return htmlToText(html);
  return "";
}

export function htmlToText(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return " "; } })
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const header = (headers, name) => (headers || []).find((h) => (h.name || "").toLowerCase() === name.toLowerCase())?.value || "";

// Busca as mensagens que casam com a query e devolve cada uma já com o teor
// da publicação parseado. onProgress(feito, total) atualiza a barra.
export async function fetchPublicacoes(query = DEFAULT_QUERY, { max = 60, onProgress } = {}) {
  if (!isConnected()) throw new Error("Conecte o Gmail primeiro.");
  const ids = [];
  let pageToken = "";
  while (ids.length < max) {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(50, max - ids.length)) });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api("/messages?" + params.toString());
    (data.messages || []).forEach((m) => ids.push(m.id));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  if (onProgress) onProgress(0, ids.length);

  const out = [];
  let done = 0;
  // Concorrência limitada (5 por vez) para não estourar o rate limit do Gmail.
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const msg = await api("/messages/" + id + "?format=full");
        out.push(toPublicacao(msg));
      } catch { /* ignora a mensagem que falhou */ }
      done++;
      if (onProgress) onProgress(done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, ids.length || 1) }, worker));

  // Mais recentes primeiro.
  out.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  return out;
}

// Separa o cabeçalho "From" em nome e e-mail: 'Fulano <fulano@x.com>' →
// { nome: 'Fulano', email: 'fulano@x.com' }. Sem nome, usa o próprio e-mail.
export function parseFrom(from) {
  const s = String(from || "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) { const email = m[2].trim().toLowerCase(); return { nome: (m[1].trim() || email), email }; }
  const email = s.toLowerCase();
  return { nome: s || email, email };
}

// Busca genérica de mensagens (metadados leves: remetente, assunto, data e
// trecho). Usada pelo "Resumo do dia" — ex.: query "is:unread newer_than:1d".
// Não baixa o corpo inteiro (format=metadata), então é rápida e barata.
export async function fetchMensagens(query, { max = 40 } = {}) {
  if (!isConnected()) throw new Error("Conecte o Gmail primeiro.");
  const ids = [];
  let pageToken = "";
  while (ids.length < max) {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(50, max - ids.length)) });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api("/messages?" + params.toString());
    (data.messages || []).forEach((m) => ids.push(m.id));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  const out = [];
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const msg = await api("/messages/" + id + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date");
        out.push(toMensagem(msg));
      } catch { /* ignora a que falhou */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, ids.length || 1) }, worker));
  out.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  return out;
}

function toMensagem(msg) {
  const headers = msg.payload?.headers || [];
  const from = header(headers, "From");
  const dateHeader = header(headers, "Date");
  const dateMs = Number(msg.internalDate) || (dateHeader ? Date.parse(dateHeader) : 0) || 0;
  const { nome, email } = parseFrom(from);
  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    fromNome: nome,
    fromEmail: email,
    subject: header(headers, "Subject"),
    dateMs,
    snippet: (msg.snippet || "").trim(),
    link: "https://mail.google.com/mail/u/0/#all/" + msg.id,
  };
}

function toPublicacao(msg) {
  const headers = msg.payload?.headers || [];
  const subject = header(headers, "Subject");
  const from = header(headers, "From");
  const dateHeader = header(headers, "Date");
  const dateMs = Number(msg.internalDate) || (dateHeader ? Date.parse(dateHeader) : 0) || 0;
  const body = extractBody(msg.payload);
  const teor = (body || msg.snippet || "").trim();
  const fields = parseTeor(subject, teor);
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    dateMs,
    snippet: (msg.snippet || "").trim(),
    teor,
    ...fields,
    link: "https://mail.google.com/mail/u/0/#all/" + msg.id,
  };
}

// ---- extração dos campos do teor (heurísticas pt-BR / EPROC) ----
const CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;

function labeled(text, labelSrc) {
  const re = new RegExp("(?:^|\\n)[ \\t>|]*(?:" + labelSrc + ")[ \\t]*[:\\-–][ \\t]*([^\\n]+)", "i");
  const m = (text || "").match(re);
  return m ? m[1].replace(/\s+/g, " ").trim().replace(/[\s;|>]+$/, "") : "";
}

// Extrai o número do processo com PRIORIDADE (evita pegar um CNJ solto do topo
// do e-mail, que pode não ser o processo desta intimação):
//   1) o CNJ que vem depois de um rótulo "Processo:/Autos:/Número único"
//   2) o CNJ presente no ASSUNTO do e-mail
//   3) por último, o primeiro CNJ que aparecer no corpo
// Antes de tudo, REMOVE os links (URLs) do corpo — o EPROC costuma pôr o número
// dentro de um link (…/processo/5001302-49…) que não é o desta intimação.
function extrairNumeroProcesso(subject, teor) {
  const teorLimpo = String(teor || "").replace(/https?:\/\/\S+/gi, " ").replace(/www\.\S+/gi, " ");
  const rotulado = labeled(teorLimpo, "processo|autos|n[uú]mero\\s+[uú]nico(?:\\s+do\\s+processo)?|n[uú]mero\\s+do\\s+processo|n[uú]mero\\s+cnj");
  return (String(rotulado).match(CNJ) || [""])[0]
    || (String(subject || "").match(CNJ) || [""])[0]
    || (String(teorLimpo).match(CNJ) || [""])[0]
    || "";
}

export function parseTeor(subject, teor) {
  const numero = extrairNumeroProcesso(subject, teor);
  const orgao = labeled(teor, "[oó]rg[aã]o\\s+julgador|ju[ií]zo|vara|comarca|serventia|unidade\\s+judici[aá]ria");
  const classe = labeled(teor, "classe(?:\\s+(?:da\\s+a[çc][aã]o|processual))?|tipo\\s+de\\s+a[çc][aã]o");
  const assunto = labeled(teor, "assunto");
  const evento = labeled(teor, "evento|movimento|tipo\\s+de\\s+documento|documento|a[çc][aã]o\\s+realizada|descri[çc][aã]o");
  const partes = labeled(teor, "partes|autor(?:\\s*/\\s*r[eé]u)?|requerente|polo\\s+ativo|intimad[oa]s?");
  const prazoTxt = labeled(teor, "prazo") ||
    ((((subject || "") + "\n" + (teor || "")).match(/prazo\s+de\s+(\d+)\s*dias?/i) || [])[0] || "");
  const disp = labeled(teor, "data\\s+de\\s+disponibiliza[çc][aã]o|disponibiliza[çc][aã]o|data\\s+da\\s+publica[çc][aã]o|publica[çc][aã]o|intima[çc][aã]o\\s+em|data\\s+da\\s+intima[çc][aã]o");
  return {
    numero: numero || "",
    orgao: orgao || "",
    classe: classe || "",
    assunto: assunto || "",
    evento: evento || "",
    partes: partes || "",
    prazo: prazoTxt || "",
    disponibilizacao: disp || "",
  };
}
