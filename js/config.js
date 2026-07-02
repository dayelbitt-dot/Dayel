// ================================================================
//  CONFIGURAÇÃO DA NUVEM (Supabase)
// ----------------------------------------------------------------
//  Para ligar o login e a sincronização entre celular e computador,
//  cole abaixo os 2 códigos do seu projeto Supabase (grátis).
//  Passo a passo detalhado no README.md.
//
//  Enquanto estiverem vazios, o app funciona em MODO LOCAL
//  (os dados ficam salvos só neste aparelho).
// ================================================================

export const SUPABASE_URL = "";       // ex: "https://xxxxxxxx.supabase.co"
export const SUPABASE_ANON_KEY = "";  // a chave pública "anon"

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
