// Cliente do Assistente por IA. Envia a pergunta/ordem + um retrato dos dados do
// usuário para a função do Supabase (functions/assistente), que fala com a IA
// (chave guardada no servidor) e devolve { resposta, acoes }.
// Se a função não estiver instalada (404) ou a nuvem estiver off, avisa.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./config.js";
import { client } from "./store.js";

export const assistEnabled = () => CLOUD_ENABLED;

export async function perguntar(pergunta, dados) {
  if (!CLOUD_ENABLED) return { error: "offline" };

  let token = SUPABASE_ANON_KEY;
  try { const { data } = await client().auth.getSession(); if (data?.session?.access_token) token = data.session.access_token; } catch {}

  const hoje = (() => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); })();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(SUPABASE_URL + "/functions/v1/assistente", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify({ pergunta: String(pergunta || "").slice(0, 4000), dados, hoje }),
    });
    if (res.status === 404) return { error: "nao_instalada" };
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return { error: (data && data.error) || `HTTP ${res.status}` };
    if (data.error) return { error: data.error };
    return { resposta: data.resposta || "", acoes: Array.isArray(data.acoes) ? data.acoes : [] };
  } catch (e) {
    return { error: (e && e.name === "AbortError") ? "tempo esgotado" : (e?.message || "falha de rede") };
  } finally { clearTimeout(timer); }
}
