// ============================================================
//  Assistente por IA: recebe uma PERGUNTA ou uma ORDEM em linguagem natural,
//  junto com um retrato dos dados do usuário (clientes, processos, tarefas,
//  notas, lembretes), e devolve:
//    - resposta : texto em pt-BR (resposta à pergunta OU resumo do que será feito)
//    - acoes    : lista de ações propostas para o app EXECUTAR (após confirmação)
//
//  A chave da API fica SÓ AQUI no servidor (secret) — nunca no navegador.
//
//  Deploy (uma vez):
//    supabase functions deploy assistente
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-...     (sua chave)
//  Opcional (respostas melhores): supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
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

const TOOL = {
  name: "assistente",
  description:
    "Responde à pergunta do usuário usando os DADOS fornecidos e/ou propõe AÇÕES a executar no app quando o usuário der uma ordem.",
  input_schema: {
    type: "object",
    properties: {
      resposta: {
        type: "string",
        description:
          "Resposta em português (pt-BR) ao usuário. Para PERGUNTAS: a resposta objetiva, citando nº de processo/nome de cliente/datas quando útil; se a informação não estiver nos dados, diga claramente que não encontrou. Para ORDENS: um resumo curto e claro do que será feito (ex.: 'Vou criar a tarefa \"Contestar\" para 12/07, vinculada ao processo 5007764 (cliente Luciano).').",
      },
      acoes: {
        type: "array",
        description:
          "Ações a executar SOMENTE quando o usuário der uma ordem para criar/alterar/concluir/excluir algo. Para perguntas puras, deixe vazio []. Sempre que uma ação envolver um registro EXISTENTE (concluir/reabrir/excluir/adicionar andamento), use os IDs presentes nos DADOS. Nunca invente IDs.",
        items: {
          type: "object",
          properties: {
            tipo: {
              type: "string",
              enum: ["criar_tarefa", "criar_agenda", "criar_lembrete", "criar_nota", "concluir_tarefa", "reabrir_tarefa", "adicionar_andamento", "editar_processo", "excluir"],
            },
            resumo: { type: "string", description: "Frase curta descrevendo a ação, para o usuário confirmar." },
            titulo: { type: "string" },
            texto: { type: "string", description: "Corpo/descrição (nota, lembrete, andamento ou detalhe da tarefa)." },
            area: { type: "string", enum: ["pessoal", "profissional"] },
            prioridade: { type: "string", enum: ["baixa", "media", "alta"] },
            data: { type: "string", description: "Data aaaa-mm-dd (vencimento/lembrete/agenda)." },
            hora: { type: "string", description: "Hora HH:mm (para compromissos de agenda)." },
            cliente_id: { type: "string", description: "ID de um cliente existente, para vincular." },
            processo_id: { type: "string", description: "ID de um processo existente, para vincular ou receber o andamento." },
            alvo_tabela: { type: "string", enum: ["tasks", "reminders", "notes", "processes", "clients"], description: "Tabela do registro alvo (concluir/reabrir/excluir)." },
            alvo_id: { type: "string", description: "ID do registro alvo existente." },
          },
          required: ["tipo", "resumo"],
        },
      },
    },
    required: ["resposta", "acoes"],
  },
};

const SYSTEM = (hoje: string) => [
  "Você é o assistente pessoal de um advogado brasileiro, dentro do app dele. Você recebe os DADOS do usuário (clientes, processos, tarefas, notas, lembretes) em JSON e uma mensagem que pode ser uma PERGUNTA (consulta) ou uma ORDEM (comando).",
  `Hoje é ${hoje}. Use isso para interpretar 'hoje', 'amanhã', 'sexta', 'esta semana', prazos, atrasos, etc. Datas SEMPRE no formato aaaa-mm-dd; horas HH:mm.`,
  "IMPORTANTE: o campo 'dados.documentoAnexado' (quando presente) contém o TEXTO de um arquivo que o usuário anexou (ex.: uma planilha convertida em linhas com colunas separadas por ' | '). Quando a ordem se referir a 'essa tabela', 'esse arquivo', 'esses prazos', etc., USE o conteúdo de 'documentoAnexado'. Ex.: 'cadastre os prazos dessa tabela como tarefas' → crie UMA ação 'criar_tarefa' por linha de prazo do documento (título com a classe/assunto, due_date = a data do prazo final da linha, prioridade 'alta', area 'profissional'), vinculando a cliente_id/processo_id quando o nº do processo (CNJ) ou o CPF/CNPJ das partes casar com os dados. NUNCA diga que não há tabela se 'documentoAnexado' existir.",
  "Se for PERGUNTA: responda em 'resposta' USANDO SOMENTE os dados fornecidos. Seja direto e cite processo/cliente/datas quando ajudar. Se não houver a informação nos dados, diga que não encontrou — NUNCA invente.",
  "Se for ORDEM: preencha 'acoes' com o que executar e escreva em 'resposta' um resumo claro do que será feito (o usuário vai confirmar antes). Para agir sobre algo que já existe (concluir/reabrir/excluir/andamento), use os IDs exatos que estão nos dados. Para vincular tarefas a cliente/processo, use cliente_id/processo_id dos dados (case pelo nome, CPF ou nº CNJ citado).",
  "Ao criar tarefa de trabalho jurídico, use area 'profissional'. 'criar_agenda' é para compromissos com hora (audiência, reunião). 'criar_lembrete' é um aviso por data. Prazos processuais são tarefas 'profissional' com prioridade 'alta'.",
  "Para CORRIGIR o cadastro de um PROCESSO (ex.: cliente vinculado errado, partes contrárias erradas), use 'editar_processo' com alvo_id = id do processo (dos dados) e: cliente_id = id do cliente correto (ou a string 'nenhum' para remover o cliente); titulo = novo nome/descrição; texto = novas partes contrárias. Case o processo pelo nº CNJ ou pelo nome citado. Ex.: 'o processo 5001302-49… não é da Liz, tire o cliente' → editar_processo com alvo_id do processo e cliente_id 'nenhum'.",
  "Se a mensagem for ambígua ou faltar um dado essencial (ex.: qual processo), NÃO invente: deixe 'acoes' vazio e peça o esclarecimento em 'resposta'. Mas se houver 'documentoAnexado' com os dados, NÃO peça de novo — use o documento.",
  "Responda SEMPRE chamando a ferramenta 'assistente'.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "método não permitido" }, 405);
  if (!KEY) return j({ error: "ANTHROPIC_API_KEY não configurada no servidor" }, 500);

  let body: { pergunta?: string; dados?: unknown; hoje?: string; historico?: Array<{ role?: string; content?: string }> };
  try { body = await req.json(); } catch { return j({ error: "JSON inválido" }, 400); }
  const pergunta = (body.pergunta || "").slice(0, 4000).trim();
  if (!pergunta) return j({ resposta: "", acoes: [] });
  const hoje = (body.hoje || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dados = JSON.stringify(body.dados ?? {}).slice(0, 90000);

  // Os DADOS ficam no system (constantes na conversa). O histórico dá memória:
  // turnos anteriores viram mensagens user/assistant antes da mensagem atual.
  const system = SYSTEM(hoje) + `\n\nDADOS DO USUÁRIO (JSON):\n"""\n${dados}\n"""`;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of (Array.isArray(body.historico) ? body.historico : []).slice(-20)) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const content = String(m?.content || "").slice(0, 6000).trim();
    if (content) messages.push({ role, content });
  }
  // Garante alternância válida terminando em 'user': se o último do histórico já
  // for 'user', mescla; senão, adiciona a mensagem atual como novo turno 'user'.
  if (messages.length && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1].content += "\n\n" + pergunta;
  } else {
    messages.push({ role: "user", content: pergunta });
  }
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: "(início da conversa)" });

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "assistente" },
        messages,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return j({ error: data?.error?.message || `IA HTTP ${resp.status}` }, 502);
    const tu = (data.content || []).find((c: { type: string }) => c.type === "tool_use");
    const out = tu?.input || {};
    return j({ resposta: out.resposta || "", acoes: Array.isArray(out.acoes) ? out.acoes : [] });
  } catch (e) {
    return j({ error: String((e as Error)?.message || e) }, 500);
  }
});
