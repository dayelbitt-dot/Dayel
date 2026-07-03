// Leitura de documentos por IA (opcional). Chama a função do Supabase
// (supabase/functions/extrair) que fala com a IA usando uma chave guardada no
// servidor. Se a função NÃO estiver instalada (ou der erro), retorna null e o
// app cai automaticamente na leitura por regras (extract.js) — nada quebra.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./config.js";
import { client } from "./store.js";

let unavailable = false; // depois de um 404 (função não instalada) para de tentar

export function aiEnabled() { return CLOUD_ENABLED && !unavailable; }

// Devolve { cliente, processo } (campos) ou null se não der para usar a IA.
export async function aiExtract(text, want) {
  if (!aiEnabled() || !text || !text.trim()) return null;

  // Usa o token do usuário logado; senão a própria anon key (ambos são JWTs válidos).
  let token = SUPABASE_ANON_KEY;
  try { const { data } = await client().auth.getSession(); if (data?.session?.access_token) token = data.session.access_token; } catch {}

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(SUPABASE_URL + "/functions/v1/extrair", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify({ text: String(text).slice(0, 40000), want: want || ["cliente", "processo"] }),
    });
    if (res.status === 404) { unavailable = true; return null; } // função não instalada
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    if (data.cliente || data.processo) return { cliente: data.cliente || null, processo: data.processo || null };
    return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
