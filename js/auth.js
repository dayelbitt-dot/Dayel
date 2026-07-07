// Autenticação: usa Supabase Auth quando na nuvem; no modo local
// simula uma "sessão" simples só para liberar o app.
//
// OFFLINE: se a biblioteca da nuvem não carregou (sem internet), o app ainda
// entra usando o SNAPSHOT da última sessão (guardado no banco local), para o
// usuário continuar trabalhando com os dados já sincronizados.

import { client, isCloud, getSessionUser, setSessionUser } from "./store.js";

const LOCAL_SESSION_KEY = "assist:local-session";

export async function getSession() {
  if (isCloud()) {
    const sb = client();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data.session) setSessionUser(data.session.user);
      return data.session;
    }
    // Sem cliente da nuvem (offline): entra pelo snapshot local, se houver.
    const u = getSessionUser();
    return u ? { user: { id: u.id, email: u.email }, _offline: true } : null;
  }
  return localStorage.getItem(LOCAL_SESSION_KEY) ? { user: { email: "modo local" } } : null;
}

function requireClient() {
  const sb = client();
  if (!sb) throw new Error("Sem conexão com a internet. Tente novamente quando estiver online.");
  return sb;
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data?.user) setSessionUser(data.user);
}

export async function signUp(email, password) {
  const { data, error } = await requireClient().auth.signUp({ email, password });
  if (error) throw error;
  if (data?.user) setSessionUser(data.user);
  return data;
}

export function enterLocal() {
  localStorage.setItem(LOCAL_SESSION_KEY, "1");
}

export async function signOut() {
  if (isCloud()) {
    try { await requireClient().auth.signOut(); } catch { /* offline: sai localmente mesmo assim */ }
  } else {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
}

export function onAuthChange(cb) {
  if (isCloud()) {
    const sb = client();
    if (!sb) return;
    sb.auth.onAuthStateChange((_e, session) => { if (session) setSessionUser(session.user); cb(session); });
  }
}
