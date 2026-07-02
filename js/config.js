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

export const SUPABASE_URL = "https://pugquehxhquetjwzfgyq.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Z3F1ZWh4aHF1ZXRqd3pmZ3lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMDgwNDgsImV4cCI6MjA5ODU4NDA0OH0.y__6uRM_yCaCYfJD2mAlzPGDoTjv8aENenXo4VsstZA";

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
