// ============================================================
//  Função de IA: lê o texto de um documento (petição, ficha, contrato…) e
//  devolve os campos do CLIENTE e do PROCESSO já organizados.
//  A chave da API fica SÓ AQUI no servidor (secret) — nunca no navegador.
//
//  Deploy (uma vez):
//    supabase functions deploy extrair
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-...     (sua chave)
//  Opcional: supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
// ============================================================

const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const j = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

// Campos que a IA deve devolver (mesma estrutura dos cadastros do app).
const CLIENTE_PROPS = {
  nome: { type: "string" },
  cpf: { type: "string", description: "CPF 000.000.000-00 ou CNPJ 00.000.000/0000-00" },
  rg: { type: "string" },
  tel: { type: "string" },
  email: { type: "string" },
  nasc: { type: "string", description: "Data de nascimento em aaaa-mm-dd" },
  endereco: { type: "string" },
  nacionalidade: { type: "string", description: "Ex.: brasileira, brasileiro" },
  estado_civil: { type: "string", description: "Ex.: casada, solteiro, divorciada, viúvo" },
  profissao: { type: "string", description: "Profissão/ocupação" },
  area: { type: "string", description: "Área do direito (ex.: Família, Cível)" },
  origem: { type: "string" },
  obs: { type: "string", description: "Filiação, naturalidade e outros dados úteis que não têm campo próprio" },
};
const TOOL = {
  name: "registrar",
  description: "Registra os dados extraídos do documento nos campos dos clientes e do processo.",
  input_schema: {
    type: "object",
    properties: {
      clientes: {
        type: "array",
        description: "TODAS as partes REPRESENTADAS (nossos clientes): requerentes, autores, exequentes, outorgantes. Em divórcio consensual, AMBOS os cônjuges são clientes. NUNCA inclua a parte contrária aqui.",
        items: { type: "object", properties: CLIENTE_PROPS },
      },
      processo: {
        type: "object",
        properties: {
          num: { type: "string", description: "Número CNJ, se houver" },
          nome: { type: "string", description: "Descrição curta: 'Tipo — Cliente'" },
          tipo: { type: "string", description: "Tipo/classe da ação (ex.: Divórcio, Alimentos, Cobrança)" },
          vara: { type: "string", description: "Vara/Juízo e comarca" },
          tribunal: { type: "string" },
          partes: { type: "string", description: "Parte(s) contrária(s)" },
          data_distribuicao: { type: "string", description: "aaaa-mm-dd, se houver" },
          fase: { type: "string" },
          valor: { type: "number", description: "Valor da causa em reais (só o número)" },
          grau: { type: "string", enum: ["1", "2"] },
          obs: { type: "string" },
        },
      },
    },
    required: ["clientes", "processo"],
  },
};

const SYSTEM = [
  "Você é um assistente jurídico brasileiro que extrai dados de documentos (petições, fichas, contratos, procurações).",
  "Preencha APENAS o que estiver escrito no documento. Se um campo não aparecer, deixe-o como string vazia (ou omita). NUNCA invente dados.",
  "Os CLIENTES são as partes representadas pelo advogado. Podem ser o(s) AUTOR(es)/requerente(s) OU o(s) RÉU(s)/requerido(s) — o advogado pode representar qualquer lado.",
  "Se houver INSTRUÇÃO do usuário no início do texto (ex.: 'cadastre o réu', 'cadastre a requerida', 'cadastre Fulano e Beltrano', 'cadastre as duas partes'), SIGA a instrução para decidir quais partes vão em 'clientes'.",
  "Sem instrução explícita, assuma que os clientes são os requerentes/autores. Em divórcio consensual ou litisconsórcio há MAIS DE UMA parte no mesmo lado — liste TODAS.",
  "As partes do outro lado (as que NÃO são clientes) vão em processo.partes.",
  "Datas SEMPRE no formato aaaa-mm-dd. CPF no formato 000.000.000-00. Valor da causa como número em reais (ex.: 30000).",
  "Estado civil, profissão, nacionalidade e filiação de cada cliente vão no obs dele.",
  "Responda chamando a ferramenta 'registrar'.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "método não permitido" }, 405);
  if (!KEY) return j({ error: "ANTHROPIC_API_KEY não configurada no servidor" }, 500);

  let body: { text?: string; want?: string[] };
  try { body = await req.json(); } catch { return j({ error: "JSON inválido" }, 400); }
  const text = (body.text || "").slice(0, 40000);
  if (!text.trim()) return j({ clientes: [], processo: {} });
  const want = Array.isArray(body.want) && body.want.length ? body.want.join(" e ") : "cliente e processo";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "registrar" },
        messages: [{ role: "user", content: `Extraia os dados para: ${want}.\n\nDOCUMENTO:\n"""\n${text}\n"""` }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return j({ error: data?.error?.message || `IA HTTP ${resp.status}` }, 502);
    const tu = (data.content || []).find((c: { type: string }) => c.type === "tool_use");
    const out = tu?.input || {};
    const clientes = Array.isArray(out.clientes) ? out.clientes : (out.cliente ? [out.cliente] : []);
    return j({ clientes, processo: out.processo || {} });
  } catch (e) {
    return j({ error: String((e as Error)?.message || e) }, 500);
  }
});
