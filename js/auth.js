// Autenticação: usa Supabase Auth quando na nuvem; no modo local
// simula uma "sessão" simples só para liberar o app.

import { client, isCloud } from "./store.js";

const LOCAL_SESSION_KEY = "assist:local-session";

export async function getSession() {
  if (isCloud()) {
    const { data } = await client().auth.getSession();
    return data.session;
  }
  return localStorage.getItem(LOCAL_SESSION_KEY) ? { user: { email: "modo local" } } : null;
}

export async function signIn(email, password) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const { data, error } = await client().auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export function enterLocal() {
  localStorage.setItem(LOCAL_SESSION_KEY, "1");
}

export async function signOut() {
  if (isCloud()) {
    await client().auth.signOut();
  } else {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
}

export function onAuthChange(cb) {
  if (isCloud()) {
    client().auth.onAuthStateChange((_e, session) => cb(session));
  }
}
