// Motor do assistente: monta o retrato dos dados que a IA consulta e EXECUTA as
// ações que ela propõe (criar/editar/abrir/ligar…). É compartilhado pela Home
// (conversa principal) e pela Captura rápida — uma única implementação.

import { list, insert, update, remove } from "./store.js";
import { todayISO } from "./ui.js";

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const friendlyErr = (e) =>
  e === "nao_instalada" ? "A IA ainda não foi ativada no servidor (veja o README, função “assistente”)."
  : e === "offline" ? "Este recurso precisa da nuvem (Supabase) configurada."
  : "Não consegui falar com a IA agora: " + e;

// Retrato enxuto dos dados (com IDs) para a IA consultar e/ou agir.
export async function buildSnapshot() {
  const [clients, processes, tasks, notes, reminders] = await Promise.all([
    list("clients"), list("processes"), list("tasks"), list("notes"), list("reminders"),
  ]);
  const short = (s, n = 200) => (s == null ? "" : String(s)).slice(0, n);
  return {
    hoje: todayISO(),
    clientes: clients.map((c) => ({ id: c.id, nome: c.nome, cpf: c.cpf, tel: c.tel, email: c.email, area: c.area })),
    processos: processes.map((p) => ({
      id: p.id, num: p.num, nome: p.nome, tipo: p.tipo, vara: p.vara, tribunal: p.tribunal,
      partes: p.partes, fase: p.fase, status: p.status, grau: p.grau, client_id: p.client_id,
      andamentos: Array.isArray(p.andamentos) ? p.andamentos.slice(-3).map((a) => ({ data: a.data, texto: short(a.texto, 160) })) : [],
    })),
    tarefas: tasks.map((t) => ({
      id: t.id, title: t.title, area: t.area, priority: t.priority, due_date: t.due_date,
      due_time: t.due_time, done: t.done, client_id: t.client_id, process_id: t.process_id, description: short(t.description, 160),
    })),
    notas: notes.map((n) => ({ id: n.id, title: n.title, body: short(n.body, 300) })),
    lembretes: reminders.map((r) => ({ id: r.id, title: r.title, remind_on: r.remind_on })),
  };
}

// Traduz o nome de página que a IA usa para a rota do app.
export function rotaDePagina(p) {
  const map = {
    inicio: "home", home: "home", agenda: "agenda", calendario: "agenda",
    clientes: "clients", processos: "processes", publicacoes: "publicacoes",
    documentos: "docs", lembretes: "reminders", pessoal: "personal",
    trabalho: "professional", tarefas: "professional", notas: "notes",
    contatos: "contacts", aniversarios: "birthdays", captura: "captura",
  };
  return map[norm(p)] || "home";
}

// A ação só navega/abre uma tela (não altera dados nem abre app externo)?
// Estas rodam sem confirmação. Ligar/WhatsApp NÃO entram: precisam do toque do
// usuário no "Executar" (sem um gesto recente o navegador bloqueia o discador
// e o pop-up do WhatsApp em silêncio).
export const acaoImediata = (a) => /^abrir_/.test(a?.tipo || "");

// Resolve o cliente_id vindo da IA: id existente → usa; nome → casa; senão null.
// (NUNCA grava um id inválido — o banco rejeitaria e a ação toda falharia.)
function resolveClientId(cid, clients) {
  if (!cid || cid === "nenhum") return null;
  if (clients.some((c) => c.id === cid)) return cid;
  const alvo = norm(cid);
  const achado = clients.find((c) => norm(c.nome) === alvo) ||
    (alvo.length >= 4 ? clients.find((c) => norm(c.nome).includes(alvo)) : null);
  return achado ? achado.id : null;
}

async function telefoneDe(a) {
  let tel = (a.telefone || "").trim();
  if (!tel && (a.cliente_id || a.alvo_id)) {
    const clients = await list("clients");
    const c = clients.find((x) => x.id === (a.cliente_id || a.alvo_id)) ||
      clients.find((x) => norm(x.nome) === norm(a.cliente_id || "")) || null;
    tel = c ? (c.tel || "") : "";
    if (c && !tel) throw new Error(`${c.nome} está sem telefone cadastrado`);
  }
  const digits = tel.replace(/\D/g, "");
  if (!digits) throw new Error("sem telefone");
  // Normaliza para o formato internacional 55DDDNÚMERO (não duplica o DDI se o
  // telefone já veio com +55, ex.: ditado pelo usuário ou lido de documento).
  return (digits.length > 11 && digits.startsWith("55")) ? digits : "55" + digits;
}

// Executa UMA ação proposta pela IA e devolve como desfazê-la ({undo}) — ou
// null quando não há o que desfazer (navegação, ligação…).
// ctx (opcional): { abrirPagina(pagina), abrirProcesso(id), abrirCliente(id) }.
export async function executarAcao(a, ctx = {}) {
  switch (a.tipo) {
    case "criar_tarefa":
    case "criar_agenda": {
      const rec = await insert("tasks", {
        title: a.titulo || a.texto || "(sem título)", area: a.area || "profissional",
        priority: a.prioridade || "media", due_date: a.data || null, due_time: a.hora || null,
        done: false, description: a.texto || null, client_id: a.cliente_id || null, process_id: a.processo_id || null,
      });
      return { undo: () => remove("tasks", rec.id) };
    }
    case "criar_lembrete": {
      const rec = await insert("reminders", { title: a.titulo || a.texto || "Lembrete", body: a.texto || "", remind_on: a.data || null });
      return { undo: () => remove("reminders", rec.id) };
    }
    case "criar_nota": {
      const rec = await insert("notes", { title: a.titulo || "", body: a.texto || a.titulo || "" });
      return { undo: () => remove("notes", rec.id) };
    }
    case "criar_cliente": {
      const nome = (a.nome || a.titulo || "").trim();
      if (!nome) throw new Error("sem o nome do cliente");
      const rec = await insert("clients", {
        nome, cpf: (a.cpf || "").trim(), tel: (a.telefone || "").trim(),
        email: (a.email || "").trim(), endereco: (a.endereco || "").trim(), obs: (a.texto || "").trim(),
      });
      // clientId permite ao executor vincular um criar_processo da mesma leva.
      return { undo: () => remove("clients", rec.id), clientId: rec.id };
    }
    case "criar_processo": {
      const clients = await list("clients");
      const clientId = resolveClientId(a.cliente_id, clients);
      const cliNome = clientId ? (clients.find((c) => c.id === clientId)?.nome || "") : "";
      const nome = a.titulo || [a.tipo_acao, cliNome].filter(Boolean).join(" — ") || ("Processo " + (a.numero || "novo"));
      const rec = await insert("processes", {
        num: (a.numero || "").trim(), nome, tipo: a.tipo_acao || "", client_id: clientId,
        partes: a.texto || null, status: "Ativo", grau: "1", andamentos: [],
      });
      return { undo: () => remove("processes", rec.id) };
    }
    case "concluir_tarefa": {
      if (!a.alvo_id) throw new Error("sem alvo");
      await update("tasks", a.alvo_id, { done: true, done_at: new Date().toISOString() });
      return { undo: () => update("tasks", a.alvo_id, { done: false, done_at: null }) };
    }
    case "reabrir_tarefa": {
      if (!a.alvo_id) throw new Error("sem alvo");
      await update("tasks", a.alvo_id, { done: false, done_at: null });
      return { undo: () => update("tasks", a.alvo_id, { done: true }) };
    }
    case "adicionar_andamento": {
      if (!a.processo_id) throw new Error("sem processo");
      const procs = await list("processes");
      const p = procs.find((x) => x.id === a.processo_id);
      if (!p) throw new Error("processo não encontrado");
      const ands = Array.isArray(p.andamentos) ? p.andamentos : [];
      const novo = { data: a.data || todayISO(), hora: a.hora || "", texto: a.texto || a.resumo || "" };
      await update("processes", a.processo_id, { andamentos: [...ands, novo] });
      return { undo: () => update("processes", a.processo_id, { andamentos: ands }) };
    }
    case "editar_processo": {
      // Corrige o cadastro de um processo (ex.: cliente trocado, partes erradas).
      if (!a.alvo_id) throw new Error("sem processo");
      const [procs, clients] = await Promise.all([list("processes"), list("clients")]);
      const p = procs.find((x) => x.id === a.alvo_id);
      if (!p) throw new Error("processo não encontrado");
      const patch = {};
      if ("cliente_id" in a) patch.client_id = resolveClientId(a.cliente_id, clients);
      if (a.titulo) patch.nome = a.titulo;
      if (a.texto) patch.partes = a.texto;
      if (!Object.keys(patch).length) throw new Error("nada para alterar");
      const antes = {}; Object.keys(patch).forEach((k) => { antes[k] = p[k] ?? null; });
      await update("processes", a.alvo_id, patch);
      return { undo: () => update("processes", a.alvo_id, antes) };
    }
    case "excluir": {
      if (!a.alvo_tabela || !a.alvo_id) throw new Error("sem alvo");
      const rows = await list(a.alvo_tabela);
      const old = rows.find((x) => x.id === a.alvo_id);
      await remove(a.alvo_tabela, a.alvo_id);
      return { undo: async () => { if (old) { const { id, user_id, created_at, ...rest } = old; await insert(a.alvo_tabela, rest); } } };
    }
    case "abrir_pagina": {
      if (!ctx.abrirPagina) throw new Error("não dá para navegar a partir daqui");
      ctx.abrirPagina(a.pagina || a.titulo || "");
      return null;
    }
    case "abrir_processo": {
      const id = a.alvo_id || a.processo_id;
      if (!ctx.abrirProcesso) throw new Error("não dá para abrir a partir daqui");
      if (!id) throw new Error("sem o processo");
      ctx.abrirProcesso(id);
      return null;
    }
    case "abrir_cliente": {
      const id = a.alvo_id || a.cliente_id;
      if (!ctx.abrirCliente) throw new Error("não dá para abrir a partir daqui");
      if (!id) throw new Error("sem o cliente");
      ctx.abrirCliente(id);
      return null;
    }
    case "ligar": {
      const digits = await telefoneDe(a);
      window.open("tel:+" + digits, "_self");
      return null;
    }
    case "whatsapp": {
      const digits = await telefoneDe(a);
      const msg = a.texto ? "?text=" + encodeURIComponent(a.texto) : "";
      window.open(`https://wa.me/${digits}${msg}`, "_blank", "noopener");
      return null;
    }
    default:
      throw new Error("ação não suportada: " + a.tipo);
  }
}
