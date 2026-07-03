// Leitura de documentos por IA (opcional). Chama a função do Supabase
// (supabase/functions/extrair) que fala com a IA usando uma chave guardada no
// servidor. Se a função NÃO estiver instalada (ou der erro), retorna null e o
// app cai automaticamente na leitura por regras (extract.js) — nada quebra.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./config.js";
import { client } from "./store.js";

let unavailable = false; // depois de um 404 (função não instalada) para de tentar

export function aiEnabled() { return CLOUD_ENABLED && !unavailable; }

// Lê o COMANDO do usuário + o texto do documento e devolve o plano de ação já
// interpretado pela IA: { destinos, clientes, processo }. Retorna null se não
// der para usar a IA (o app cai nas regras do extract.js — nada quebra).
//   text    → conteúdo do(s) documento(s) anexado(s)
//   want    → destinos que o usuário já escolheu à mão (ou null: a IA decide)
//   command → a ordem que o usuário digitou/ditou ("cadastre a cliente", etc.)
export async function aiExtract(text, want, command) {
  if (!aiEnabled()) return null;
  const doc = (text || "").trim();
  const cmd = (command || "").trim();
  if (!doc && !cmd) return null;

  // Usa o token do usuário logado; senão a própria anon key (ambos são JWTs válidos).
  let token = SUPABASE_ANON_KEY;
  try { const { data } = await client().auth.getSession(); if (data?.session?.access_token) token = data.session.access_token; } catch {}

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(SUPABASE_URL + "/functions/v1/extrair", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify({
        text: String(text || "").slice(0, 40000),
        command: cmd.slice(0, 2000),
        want: want && want.length ? want : null,
      }),
    });
    if (res.status === 404) { unavailable = true; return null; } // função não instalada
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    // Aceita a versão nova (clientes: []) e a antiga (cliente: {}).
    const clientes = Array.isArray(data.clientes) ? data.clientes.filter(Boolean)
      : (data.cliente ? [data.cliente] : []);
    const destinos = Array.isArray(data.destinos) ? data.destinos.filter(Boolean) : null;
    if (clientes.length || data.processo || (destinos && destinos.length))
      return { destinos, clientes, processo: data.processo || null };
    return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
