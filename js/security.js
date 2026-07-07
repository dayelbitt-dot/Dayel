// ================================================================
//  SEGURANÇA LOCAL (bloqueio + criptografia)
// ----------------------------------------------------------------
//  Protege os dados sensíveis guardados no aparelho (CPF, processos…):
//   • CRIPTOGRAFIA de verdade — cada registro do banco local é cifrado
//     com AES-GCM. A chave NÃO fica salva: é derivada do seu PIN
//     (PBKDF2, 210 mil iterações) e vive só na memória enquanto o app
//     está destravado. Sem o PIN, os dados no disco são ilegíveis.
//   • BLOQUEIO por PIN (e biometria, quando o navegador suporta).
//   • EXPIRAÇÃO de sessão — trava sozinho após um tempo sem uso.
//   • LOGS de acesso — registra desbloqueios (e tentativas falhas).
//
//  É OPCIONAL e reversível: quem não ativa segue como antes. Ao ativar,
//  os dados são recifrados; ao desativar, voltam a texto normal.
//
//  Este módulo NÃO importa o banco (local.js) para evitar dependência
//  circular: guarda sua própria configuração em localStorage.
// ================================================================

const CFG_KEY = "assist:sec:cfg";   // { enabled, salt, verifier, iters, autolockMin, biometric }
const LOG_KEY = "assist:sec:logs";  // [{ ts, event, ok }]
const ITERS = 210000;

const encTxt = new TextEncoder();
const decTxt = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } }
function writeCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

// -------- estado em memória (chave só existe destravado) --------
let key = null;
export function securityEnabled() { return !!readCfg().enabled; }
export function unlocked() { return !!key; }
export function autolockMinutes() { return readCfg().autolockMin || 5; }

// -------- primitivas de cripto --------
async function deriveKey(pin, saltB64, iters) {
  const baseKey = await crypto.subtle.importKey("raw", encTxt.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: iters, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
async function encWith(k, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, encTxt.encode(JSON.stringify(obj)));
  return { _iv: b64(iv), _ct: b64(ct) };
}
async function decWith(k, rec) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec._iv) }, k, unb64(rec._ct));
  return JSON.parse(decTxt.decode(pt));
}

// Cifra/decifra UM registro (usado pelo banco local). Exige estar destravado.
export async function encryptRecord(obj) { if (!key) throw new Error("locked"); return encWith(key, obj); }
export async function decryptRecord(rec) { if (!key) throw new Error("locked"); return decWith(key, rec); }

// -------- ativar / destravar / travar / desativar --------
// Cria a configuração para um PIN e deixa DESTRAVADO (chave em memória).
export async function provisionConfig(pin, { autolockMin } = {}) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const k = await deriveKey(pin, salt, ITERS);
  const verifier = await encWith(k, { v: "assist-ok" });
  const prev = readCfg();
  writeCfg({ enabled: true, salt, verifier, iters: ITERS, autolockMin: autolockMin || prev.autolockMin || 5 });
  key = k;
  log("enable", true);
  return true;
}

// Destrava com o PIN. Seta a chave em memória; erro se o PIN não confere.
export async function unlock(pin) {
  const cfg = readCfg();
  if (!cfg.enabled) return true;
  const k = await deriveKey(pin, cfg.salt, cfg.iters);
  try {
    const v = await decWith(k, cfg.verifier);
    if (v && v.v === "assist-ok") { key = k; log("unlock", true); emitUnlock(); return true; }
  } catch { /* PIN errado → cai abaixo */ }
  log("unlock", false);
  throw new Error("PIN incorreto");
}

export function lock(reason = "manual") {
  if (!key) return;
  key = null;
  log(reason === "auto" ? "autolock" : "lock", true);
  emitLock();
}

// Remove a proteção (dados voltam a texto normal — a recifragem é feita pelo
// store, que decifra tudo antes de chamar aqui).
export function clearConfig() {
  const prev = readCfg();
  writeCfg({ autolockMin: prev.autolockMin || 5 }); // some enabled/salt/verifier
  key = null;
  log("disable", true);
}

// Reset DURO (esqueci o PIN): remove a proteção e a chave sem tentar decifrar.
// Os dados locais cifrados ficam ilegíveis mesmo — quem chama deve apagá-los
// (clearLocal) e recarregar da nuvem depois de entrar de novo.
export function resetSecurity() {
  localStorage.removeItem(CFG_KEY);
  key = null;
}

export function setAutolockMinutes(min) {
  const cfg = readCfg();
  cfg.autolockMin = Math.max(1, Number(min) || 5);
  writeCfg(cfg);
  if (securityEnabled()) startAutoLock();
}

// -------- expiração de sessão (auto-bloqueio por inatividade) --------
let idleTimer = null;
const bump = () => resetIdle();
function resetIdle() {
  if (!securityEnabled() || !unlocked()) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lock("auto"), autolockMinutes() * 60000);
}
export function startAutoLock() {
  stopAutoLock();
  if (!securityEnabled()) return;
  ["pointerdown", "keydown", "touchstart", "visibilitychange"].forEach((e) => window.addEventListener(e, bump, { passive: true }));
  resetIdle();
}
export function stopAutoLock() {
  clearTimeout(idleTimer);
  ["pointerdown", "keydown", "touchstart", "visibilitychange"].forEach((e) => window.removeEventListener(e, bump));
}

// -------- avisos para a interface --------
const lockListeners = new Set();
export function onLockChange(cb) { lockListeners.add(cb); return () => lockListeners.delete(cb); }
function emitLock() { lockListeners.forEach((cb) => { try { cb({ locked: true }); } catch {} }); try { window.dispatchEvent(new CustomEvent("assist:lock")); } catch {} }
function emitUnlock() { lockListeners.forEach((cb) => { try { cb({ locked: false }); } catch {} }); try { window.dispatchEvent(new CustomEvent("assist:unlock")); } catch {} }

// -------- logs de acesso --------
function log(event, ok) {
  try {
    const arr = JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    arr.push({ ts: new Date().toISOString(), event, ok: !!ok });
    localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-100)));
  } catch {}
}
export function accessLogs() { try { return (JSON.parse(localStorage.getItem(LOG_KEY)) || []).slice().reverse(); } catch { return []; } }
export function clearLogs() { localStorage.removeItem(LOG_KEY); }
