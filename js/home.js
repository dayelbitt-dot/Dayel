// A nova Home "IA em primeiro lugar": saudação, conversa central com o
// assistente (que responde E executa), sugestões inteligentes e o painel "Hoje".
// Toda a estrutura antiga do app continua atrás do botão ☰ Menu.

import { $, el, todayISO, prettyDate, toast } from "./ui.js";
import { list } from "./store.js";
import { assistEnabled, perguntar } from "./assist.js";
import { buildSnapshot, executarAcao, friendlyErr, rotaDePagina, acaoImediata } from "./agent.js";
import { extractTextFromFile } from "./files.js";
import { parseNaturalTask } from "./nlp.js";
import { rank } from "./search.js";
import * as gcal from "./gcal.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---- estado do módulo (sobrevive à navegação; a conversa fica no aparelho) ----
const CHAT_KEY = "assist:home_chat";
const NAME_KEY = "assist:user_name";
const PUB_CACHE_KEY = "assist:publicacoes";
let chat = loadChat();      // [{role:'user'|'assistant', text, acoes?, done?, doneMsg?, error?}]
let chatGen = 0;            // "geração" da conversa: invalida respostas em voo ao limpar
let thinking = false;
let attachments = [];       // {name, size, text} — conteúdo lido dos arquivos
let ui = null;              // referências dos nós desta montagem
let lastCtx = null;

// ---- eventos do Google Agenda para a Home (cache que sobrevive à navegação) ----
// Carregamos os compromissos de hoje em segundo plano (sem travar a tela) e
// redesenhamos a Home quando chegam. Guardamos por dia para não rebuscar à toa.
let googleEventos = [];     // eventos de hoje já mapeados (via gcal.listEvents)
let googleLoadedDay = null; // ISO do dia já carregado
let googleLoading = false;
let googleSilentAt = 0;     // cooldown da reconexão silenciosa

function loadChat() {
  try { const v = JSON.parse(localStorage.getItem(CHAT_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveChat() {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-40).map(({ role, text, acoes, done, doneMsg, error }) => ({ role, text, acoes, done, doneMsg, error })))); } catch {}
}

// ---- nome do usuário (saudação). Deriva do e-mail; toque no nome para ajustar. ----
function userName(email) {
  const saved = (localStorage.getItem(NAME_KEY) || "").trim();
  if (saved) return saved;
  if (!email || !email.includes("@")) return ""; // modo local: sem nome até você definir
  let n = email.split("@")[0].replace(/[._\-\d]+/g, " ").trim();
  const m = n.match(/^(?:adv|dra?)\s*(.{3,})$/i); // "advdayel" → "dayel"
  if (m) n = m[1];
  n = n.split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}
function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + "s")}`;

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function svgIcon(id, cls = "home-svg") {
  const span = el("span", { class: cls });
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  return span;
}

// ============================================================
//  PÁGINA
// ============================================================
export async function renderHome(ctx) {
  lastCtx = ctx;
  const main = $("#main");
  main.innerHTML = '<div class="empty">Carregando…</div>';

  // ---- dados do dia (tudo em paralelo; qualquer falha vira lista vazia) ----
  let tasks = [], reminders = [], contacts = [];
  try {
    [tasks, reminders, contacts] = await Promise.all([
      list("tasks"), list("reminders"), list("contacts").catch(() => []),
    ]);
  } catch {}
  const hoje = todayISO();
  const em7 = addDaysISO(hoje, 7);
  const em30 = addDaysISO(hoje, 30);

  const pendentes = tasks.filter((t) => !t.done);
  const atrasadas = pendentes.filter((t) => t.due_date && t.due_date < hoje);
  // Prazo = tarefa de trabalho com cara de prazo processual. Separamos os prazos
  // das tarefas comuns para o painel "Hoje" não contar um como o outro.
  const ehPrazo = (t) => t.area === "profissional" && t.due_date &&
    (t.priority === "alta" || t.process_id || /prazo|⏰|contrarraz|contesta|responder|vencimento/i.test((t.title || "") + " " + (t.description || "")));
  const todosPrazos = pendentes.filter(ehPrazo);
  const tarefas = pendentes.filter((t) => !ehPrazo(t));        // tarefas de verdade (sem prazos)
  const prazos = todosPrazos.filter((t) => t.due_date <= em7); // prazos dos próximos 7 dias (inclui atrasados)
  const prazosHoje = todosPrazos.filter((t) => t.due_date <= hoje);
  const prazosVencemHoje = todosPrazos.filter((t) => t.due_date === hoje);
  const lembretesHoje = reminders.filter((r) => r.remind_on === hoje);
  // Compromissos da Agenda Google de hoje (do cache; carregados em 2º plano abaixo).
  const eventosHoje = googleEventos.filter((e) => e.date === hoje)
    .sort((a, b) => ((a.time || "99:99") < (b.time || "99:99") ? -1 : 1));
  const compromissosHoje = pendentes.filter((t) => t.due_date === hoje && t.due_time).length + lembretesHoje.length + eventosHoje.length;
  // "Hoje" mostra SÓ o que vence hoje: prazos, tarefas e lembretes/eventos do dia.
  const tarefasHoje = tarefas.filter((t) => t.due_date === hoje);
  const vencemHoje = pendentes.filter((t) => t.due_date === hoje).length + lembretesHoje.length;
  const audiencias = pendentes.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= em30 &&
    /audi[êe]nc/i.test((t.title || "") + " " + (t.description || "")))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  let pubsNovas = 0, pubs = [];
  try {
    pubs = JSON.parse(localStorage.getItem(PUB_CACHE_KEY)) || [];
    const corte = Date.now() - 7 * 86400000;
    pubsNovas = pubs.filter((p) => (p.dateMs || 0) >= corte).length;
  } catch {}
  const aniversarios = contacts.filter((c) => {
    const m = String(c.nasc || "").slice(5, 10);
    return m && m === hoje.slice(5, 10);
  });

  // ---- resumo inteligente do dia (uma linha, sob a saudação) ----
  const resumoBits = [];
  if (prazosHoje.length) resumoBits.push(plural(prazosHoje.length, "prazo vencendo hoje", "prazos vencendo hoje"));
  if (compromissosHoje) resumoBits.push(plural(compromissosHoje, "compromisso hoje", "compromissos hoje"));
  if (tarefas.length) resumoBits.push(plural(tarefas.length, "tarefa pendente", "tarefas pendentes"));
  const resumoLinha = resumoBits.length ? "Você tem " + resumoBits.join(", ") + "." : "Tudo em dia por aqui. ✨";

  // ---- cabeçalho ----
  const nome = userName(ctx.email);
  const nomeEl = el("button", {
    class: "home-nome", title: "Toque para ajustar como quer ser chamado",
    onclick: () => {
      const novo = prompt("Como você quer ser chamado?", nome);
      if (novo != null) { try { localStorage.setItem(NAME_KEY, novo.trim()); } catch {} renderHome(ctx); }
    },
  }, nome ? ", " + nome + "." : ".");
  const hero = el("div", { class: "home-hero" }, [
    el("h1", { class: "home-hi" }, [saudacao(), nomeEl]),
    el("p", { class: "home-sub" }, "O que vamos fazer hoje?"),
    el("p", { class: "home-resumo" }, resumoLinha),
  ]);

  // ---- conversa (o coração da Home) ----
  const chatWrap = el("div", { class: "home-chat" });
  const input = el("textarea", {
    class: "home-input", rows: "1",
    placeholder: "Escreva um comando ou uma pergunta…",
  });
  const statusEl = el("div", { class: "home-status" });
  const attWrap = el("div", { class: "home-atts" });
  const micBtn = el("button", { type: "button", class: "home-tool", title: "Falar" }, [svgIcon("i-mic")]);
  const clipBtn = el("button", { type: "button", class: "home-tool", title: "Anexar documento" }, [svgIcon("i-clip")]);
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,.xlsx,.xls,text/plain", multiple: "" });
  const sendBtn = el("button", { type: "button", class: "home-send", title: "Enviar" }, [svgIcon("i-send")]);
  const composer = el("div", { class: "home-composer" }, [
    chatWrap,
    input,
    attWrap,
    statusEl,
    el("div", { class: "home-tools" }, [micBtn, clipBtn, fileInput, sendBtn]),
  ]);

  // exemplos de comando (aparecem só com a conversa vazia)
  const exemplos = el("div", { class: "home-examples" },
    ["Cadastrar novo cliente", "Crie uma tarefa para amanhã às 14h", "Quais são os prazos desta semana?", "Abrir a agenda"]
      .map((t) => el("button", { class: "ex-chip", onclick: () => { input.value = t; autosize(); input.focus(); } }, t)));

  // ---- painel "Hoje": agenda COMPLETA do dia (ou dos próximos 5 dias) ----
  // Em vez de só um resumo com números, listamos cada item por extenso:
  // compromissos, prazos, tarefas, lembretes, aniversários e publicações. Se
  // não houver nada hoje, mostramos o que é importante nos próximos 5 dias.
  const pubDiaISO = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function itensDoDia(dia) {
    const itens = [];
    // Compromissos da Agenda Google
    googleEventos.filter((e) => e.date === dia).forEach((e) => itens.push({
      ord: e.time || "00:00", icon: "📅", titulo: e.title || "Compromisso",
      sub: [e.time ? e.time + (e.endTime ? "–" + e.endTime : "") : "dia todo", e.location].filter(Boolean).join(" · "),
      onClick: () => ctx.navigate("agenda"),
    }));
    // Prazos e tarefas com vencimento no dia
    pendentes.filter((t) => t.due_date === dia).forEach((t) => {
      const prazo = ehPrazo(t);
      itens.push({
        ord: t.due_time || (prazo ? "06:00" : "23:50"), icon: prazo ? "⏰" : "✔️",
        titulo: t.title || (prazo ? "Prazo" : "Tarefa"),
        sub: [prazo ? "Prazo processual" : "Tarefa", t.due_time ? "às " + t.due_time : null, t.priority === "alta" ? "prioridade alta" : null].filter(Boolean).join(" · "),
        onClick: () => ctx.navigate(t.area === "profissional" ? "professional" : "personal"),
      });
    });
    // Lembretes do dia
    reminders.filter((r) => r.remind_on === dia).forEach((r) => itens.push({
      ord: "23:55", icon: "🔔", titulo: r.title || "Lembrete",
      sub: ["Lembrete", (r.body || "").replace(/\s+/g, " ").trim().slice(0, 60) || null].filter(Boolean).join(" · "),
      onClick: () => ctx.navigate("reminders"),
    }));
    // Aniversários do dia
    contacts.filter((c) => { const m = String(c.nasc || "").slice(5, 10); return m && m === dia.slice(5, 10); }).forEach((c) => itens.push({
      ord: "00:01", icon: "🎂", titulo: "Aniversário de " + (c.nome || "").split(/\s+/).slice(0, 2).join(" "),
      sub: c.relacao || "Contato", onClick: () => ctx.navigate("birthdays"),
    }));
    // Publicações oficiais recebidas no dia
    pubs.filter((p) => p.dateMs && pubDiaISO(p.dateMs) === dia).forEach((p) => itens.push({
      ord: "00:00", icon: "📰", titulo: p.assunto || p.subject || "Publicação oficial",
      sub: ["Publicação EPROC", p.numero].filter(Boolean).join(" · "), onClick: () => ctx.navigate("publicacoes"),
    }));
    return itens.sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
  }

  const rotuloDia = (iso) => {
    if (iso === addDaysISO(hoje, 1)) return "Amanhã";
    const d = new Date(iso + "T00:00:00");
    const sem = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d.getDay()];
    return sem + " · " + prettyDate(iso);
  };
  const itemRow = (it) => el("button", { class: "hoje-item", onclick: it.onClick }, [
    el("span", { class: "hoje-item-ic" }, it.icon),
    el("span", { class: "hoje-item-body" }, [
      el("span", { class: "hoje-item-tit" }, it.titulo),
      it.sub ? el("span", { class: "hoje-item-sub" }, it.sub) : null,
    ]),
    el("span", { class: "hoje-item-go" }, "›"),
  ]);

  const itensHoje = itensDoDia(hoje);
  let hojeSection;
  if (itensHoje.length) {
    hojeSection = el("div", { class: "home-hoje" }, [
      el("div", { class: "hoje-title" }, "Hoje · " + prettyDate(hoje)),
      el("div", { class: "card hoje-detalhe" }, itensHoje.map(itemRow)),
    ]);
  } else {
    const blocos = [];
    for (let i = 1; i <= 5; i++) {
      const d = addDaysISO(hoje, i);
      const its = itensDoDia(d);
      if (its.length) blocos.push(el("div", { class: "hoje-dia" }, [
        el("div", { class: "hoje-dia-lbl" }, rotuloDia(d)),
        el("div", { class: "card hoje-detalhe" }, its.map(itemRow)),
      ]));
    }
    hojeSection = el("div", { class: "home-hoje" }, [
      el("div", { class: "hoje-title" }, blocos.length ? "Nada para hoje — próximos 5 dias" : "Hoje"),
      blocos.length
        ? el("div", { class: "hoje-dias" }, blocos)
        : el("div", { class: "card home-empty" }, "Nada urgente para hoje nem nos próximos 5 dias. Se quiser adiantar algo, é só me pedir aqui em cima. ✨"),
    ]);
  }

  main.innerHTML = "";
  main.append(hero, composer, exemplos, hojeSection);

  // ---- comportamento ----
  ui = { chatWrap, input, statusEl, attWrap, micBtn, sendBtn, exemplos };
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ctx); }
  });
  sendBtn.onclick = () => send(ctx);

  // voz (mesmo reconhecimento da captura)
  let rec = null;
  if (!SR) { micBtn.disabled = true; micBtn.title = "Seu navegador não suporta gravação de voz"; }
  else micBtn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
    let base = input.value ? input.value.trim() + " " : "";
    micBtn.classList.add("recording");
    statusEl.textContent = "🎙️ Fale agora… (toque de novo para parar)";
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += tr + " "; else interim += tr;
      }
      if (final) base += final;
      input.value = (base + interim).replace(/\s+/g, " ").trimStart();
      autosize();
    };
    const stop = () => { rec = null; micBtn.classList.remove("recording"); statusEl.textContent = ""; };
    rec.onend = stop;
    rec.onerror = (ev) => { stop(); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("Permita o acesso ao microfone para gravar."); };
    rec.start();
  };

  // anexos: lê o conteúdo e manda junto para a IA (ex.: "cadastre este cliente")
  clipBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = [...fileInput.files]; fileInput.value = "";
    for (const file of files) {
      statusEl.textContent = `📄 Lendo “${file.name}”…`;
      let text = "";
      try { text = (await extractTextFromFile(file, (m) => { statusEl.textContent = m; }) || "").trim(); } catch {}
      attachments.push({ name: file.name, size: file.size, text });
      statusEl.textContent = text ? `📎 “${file.name}” lido — escreva o que fazer com ele e envie.` : `⚠️ Não consegui ler “${file.name}” (escaneado/protegido?).`;
    }
    drawAtts();
  };
  function drawAtts() {
    attWrap.innerHTML = "";
    attachments.forEach((a, i) => attWrap.append(el("span", { class: "home-att" }, [
      "📎 " + a.name,
      el("button", { type: "button", class: "home-att-x", onclick: () => { attachments.splice(i, 1); drawAtts(); } }, "×"),
    ])));
  }
  drawAtts();

  paintChat(ctx);
  autosize();

  // Busca os compromissos do Google Agenda em segundo plano (nunca trava a tela).
  // Quando chegam, a Home é redesenhada com eles somados aos compromissos de hoje.
  ensureGoogleHoje(hoje, ctx);
}

// Reconecta em silêncio (sem pop-up) e busca os eventos de HOJE do Google Agenda.
// Espelha o ensureGoogleEvents da Agenda: assíncrono, com cache por dia, e só
// redesenha se você ainda estiver na Home quando os dados chegarem.
async function ensureGoogleHoje(hoje, ctx) {
  if (!gcal.googleEnabled() || googleLoading) return;
  if (googleLoadedDay === hoje) return; // já carregado hoje → nada a fazer

  const naHome = () => ctx && ctx.rotaAtual && ctx.rotaAtual() === "home";

  // Não conectado (nunca ou token de 1h expirou): tenta renovar em silêncio.
  if (!gcal.isConnected()) {
    if (!gcal.wasLinked()) return;                       // nunca vinculou → não insiste
    if (Date.now() - googleSilentAt < 20000) return;     // cooldown p/ não repetir à toa
    googleSilentAt = Date.now();
    googleLoading = true;
    try { await gcal.connect(false); } catch {}
    googleLoading = false;
    if (!gcal.isConnected()) return;                     // continuou sem sessão → desiste
  }

  googleLoading = true;
  try {
    // Carrega a janela de hoje até +5 dias — assim a agenda detalhada da Home
    // mostra os compromissos do dia e, quando hoje está vazio, os próximos 5.
    const ini = new Date(hoje + "T00:00:00");
    const fim = new Date(addDaysISO(hoje, 5) + "T23:59:59");
    googleEventos = await gcal.listEvents(ini.toISOString(), fim.toISOString());
    googleLoadedDay = hoje;
  } catch { /* silencioso: mantém o cache anterior */ }
  finally {
    googleLoading = false;
    if (naHome()) renderHome(ctx);
  }
}

// ============================================================
//  CONVERSA
// ============================================================
function paintChat(ctx) {
  if (!ui) return;
  const { chatWrap, exemplos } = ui;
  chatWrap.innerHTML = "";
  const ativo = chat.length > 0 || thinking;
  chatWrap.classList.toggle("hidden", !ativo);
  exemplos.classList.toggle("hidden", ativo);
  if (!ativo) return;

  const log = el("div", { class: "cap-chat home-log" });
  chat.forEach((m, idx) => {
    if (m.role === "user") { log.append(el("div", { class: "cap-msg user" }, m.text)); return; }
    const bubble = el("div", { class: "cap-msg ai" + (m.error ? " err" : "") });
    if (m.text) bubble.append(el("div", { class: "cap-msg-txt" }, m.text));
    const isLast = idx === chat.length - 1;
    if (m.acoes && m.acoes.length && !m.done && !m.executando) {
      const box = el("div", { class: "cap-ai-confirm" }, [
        el("div", { class: "cap-ai-lbl" }, "Aprovar e executar?"),
        el("ul", { class: "cap-ai-acts" }, m.acoes.map((a) => el("li", {}, a.resumo || a.tipo))),
      ]);
      if (isLast) {
        const confirmar = el("button", { type: "button", class: "btn btn-primary btn-sm" }, `✓ Executar (${m.acoes.length})`);
        const descartar = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "Descartar");
        confirmar.onclick = () => { if (m.executando) return; confirmar.disabled = true; descartar.disabled = true; confirmar.textContent = "Executando…"; executarAcoes(m, ctx); };
        descartar.onclick = () => { m.acoes = []; saveChat(); paintChat(ctx); };
        box.append(el("div", { class: "cap-ai-btns" }, [descartar, confirmar]));
      } else {
        box.append(el("div", { class: "t2" }, "Proposta antiga — peça de novo se ainda quiser."));
      }
      bubble.append(box);
    }
    if (m.done && m.doneMsg) bubble.append(el("div", { class: "cap-ai-done" }, m.doneMsg));
    log.append(bubble);
  });
  if (thinking) log.append(el("div", { class: "cap-msg ai" }, "Pensando…"));

  chatWrap.append(
    el("div", { class: "home-chat-top" }, [
      el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { chatGen++; thinking = false; chat = []; saveChat(); paintChat(ctx); } }, "✕ Nova conversa"),
    ]),
    log,
  );
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function ctxAcoes(ctx) {
  return {
    abrirPagina: (p) => ctx.navigate(rotaDePagina(p)),
    abrirProcesso: (id) => ctx.openProcess(id),
    abrirCliente: (id) => ctx.openClient(id),
    abrirDocumentos: (preset) => ctx.openDocumentos(preset),
  };
}

async function executarAcoes(m, ctx, { silent = false } = {}) {
  if (m.executando) return;
  m.executando = true;
  const undos = []; const erros = [];
  let ok = 0, mudouDados = false, abriuTela = false, novoClienteId = null;
  for (const a of (m.acoes || [])) {
    // Cliente + processo criados na mesma leva → vincula o processo ao cliente
    // recém-criado (a IA não conhece o id dele, pois ainda não existia).
    if (a.tipo === "criar_processo" && novoClienteId && (!a.cliente_id || a.cliente_id === "nenhum")) a.cliente_id = novoClienteId;
    try {
      const u = await executarAcao(a, ctxAcoes(ctx));
      if (u) { undos.push(u); if (u.clientId) novoClienteId = u.clientId; }
      if (acaoImediata(a)) abriuTela = true; else mudouDados = true;
      ok++;
    } catch (e) { erros.push(e?.message || "falhou"); }
  }
  m.executando = false;
  m.done = true;
  const fail = erros.length;
  m.doneMsg = silent && !fail ? "" : `✅ ${plural(ok, "ação feita", "ações feitas")}${fail ? ` · ⚠️ ${fail} falhou (${erros[0]})` : ""}.`;
  saveChat();
  paintChat(ctx);
  if (!silent || fail) toast(m.doneMsg || "Feito.", {
    action: undos.length ? { label: "Desfazer", onClick: async () => {
      for (const u of undos.reverse()) { try { await u.undo(); } catch {} }
      m.done = false; m.doneMsg = null; saveChat(); toast("Desfeito.");
      if (lastCtx && lastCtx.rotaAtual && lastCtx.rotaAtual() === "home") renderHome(lastCtx);
    } } : null,
    duration: 9000,
  });
  // Dados mudaram, nenhuma ação trocou de tela e você continua na Home →
  // atualiza o resumo/painel (a conversa fica).
  if (mudouDados && !abriuTela && ctx.rotaAtual && ctx.rotaAtual() === "home") renderHome(ctx);
}

async function send(ctx) {
  if (thinking || !ui) return;
  const q = ui.input.value.trim();
  const docs = attachments.map((a) => (a.text && a.text.trim()) ? `📎 ${a.name}:\n${a.text.trim()}` : "").filter(Boolean).join("\n\n----\n\n");
  if (!q && !docs) { ui.input.focus(); return; }
  chat.push({ role: "user", text: q || "(usar o documento anexado)" });
  saveChat();
  ui.input.value = ""; ui.input.style.height = "auto";
  const gen = chatGen; // se "Nova conversa" for tocado no meio, a resposta é descartada

  // 1) Navegação e geração de documento são resolvidas NA HORA, sem ir à IA
  // (funcionam até offline).
  if (!docs) {
    const doc = await localDocs(q, ctx);
    if (gen !== chatGen) return;
    if (doc) {
      chat.push({ role: "assistant", text: doc.text });
      saveChat(); paintChat(ctx);
      setTimeout(doc.run, 250);
      return;
    }
    const nav = await localNav(q, ctx);
    if (gen !== chatGen) return;
    if (nav) {
      chat.push({ role: "assistant", text: nav.text });
      saveChat(); paintChat(ctx);
      setTimeout(nav.run, 250); // deixa a resposta aparecer antes de trocar de tela
      return;
    }
    // Offline (ou sem IA na nuvem): BUSCA SEMÂNTICA local — acha o cliente/
    // processo por sentido, mesmo sem a frase exata ("aquele inventário do
    // cliente que tinha um barco"). Online, deixa a IA da nuvem responder.
    if (!navigator.onLine || !assistEnabled()) {
      const found = await localBusca(q, ctx);
      if (gen !== chatGen) return;
      if (found) {
        chat.push({ role: "assistant", text: found.text });
        saveChat(); paintChat(ctx);
        if (found.run) setTimeout(found.run, 250);
        return;
      }
    }
  }

  // 2) IA na nuvem (com todo o contexto do escritório).
  thinking = true; paintChat(ctx);
  let r;
  // Offline (ou nuvem desligada): não perde tempo tentando a IA da nuvem —
  // cai direto na interpretação local (que roda sobre os dados do aparelho).
  if (!assistEnabled() || !navigator.onLine) r = { error: "offline" };
  else {
    try {
      const snapshot = await buildSnapshot();
      if (docs) snapshot.documentoAnexado = docs.slice(0, 70000);
      const historico = chat.slice(0, -1)
        .map((m) => ({ role: m.role, content: (m.text || (m.acoes && m.acoes.length ? "(propus ações)" : "")).slice(0, 6000) }))
        .filter((m) => m.content);
      r = await perguntar(q || "Use o documento anexado para cumprir o que ele indica.", snapshot, historico);
    } catch (e) { r = { error: e?.message || "falha" }; }
  }
  if (gen !== chatGen) return; // a conversa foi limpa enquanto a IA pensava
  thinking = false;

  if (r.error) {
    // 3) Sem IA: ainda tento interpretar localmente comandos simples de criação.
    const local = localCreate(q);
    if (local) {
      chat.push({ role: "assistant", text: local.text, acoes: local.acoes });
    } else {
      chat.push({ role: "assistant", text: "⚠️ " + friendlyErr(r.error), error: true });
    }
    saveChat(); paintChat(ctx);
    return;
  }

  attachments = []; if (ui.attWrap) ui.attWrap.innerHTML = "";
  const acoes = r.acoes || [];
  const m = { role: "assistant", text: r.resposta || (acoes.length ? "Preparei as ações abaixo." : "Não entendi — pode reformular?"), acoes };
  chat.push(m); saveChat();
  // Ações que só abrem telas rodam SEM pedir confirmação — mas apenas se você
  // ainda estiver na Home (se navegou enquanto a IA pensava, o cartão espera).
  if (acoes.length && acoes.every(acaoImediata) && ctx.rotaAtual && ctx.rotaAtual() === "home") {
    m.executando = true; // o cartão não aparece enquanto executa
    paintChat(ctx);
    m.executando = false;
    await executarAcoes(m, ctx, { silent: true });
    return;
  }
  paintChat(ctx);
  setTimeout(() => ui && ui.input.focus(), 30);
}

// ============================================================
//  INTERPRETAÇÃO LOCAL (instantânea; também é o plano B offline)
// ============================================================
const NAV_RE = /^(?:me\s+(?:leve|leva|mostre|mostra)\s+(?:a|para|pra)?|abr[ai]r?|abre|abra|mostr(?:ar?|e|a)|ver|veja|ir\s+para|v[aá]\s+(?:para|pra)|acess(?:ar?|e)|entr(?:ar?|e)\s+em)\s+/;

// Padrões ANCORADOS no início (após artigos) — nunca dentro de uma frase, para
// não "sequestrar" uma pergunta (ex.: "veja se o prazo do processo já venceu"
// deve ir para a IA, não abrir a página de Trabalho).
const ART = "(?:o\\s+|a\\s+|os\\s+|as\\s+|meus?\\s+|minhas?\\s+)?";
const PAGINAS = [
  { re: new RegExp("^" + ART + "(?:agenda|calendario|compromissos)\\b"), route: "agenda", label: "a Agenda" },
  { re: new RegExp("^" + ART + "clientes\\b"), route: "clients", label: "os Clientes" },
  { re: new RegExp("^" + ART + "processos\\b"), route: "processes", label: "os Processos" },
  { re: new RegExp("^" + ART + "(?:publicac\\w*|intimac\\w*|movimentac\\w*)"), route: "publicacoes", label: "as Publicações oficiais" },
  { re: new RegExp("^" + ART + "(?:documentos?|procurac\\w*|declarac\\w*)\\b"), route: "docs", label: "Gerar documentos" },
  { re: new RegExp("^" + ART + "lembretes?\\b"), route: "reminders", label: "os Lembretes" },
  { re: new RegExp("^" + ART + "(?:notas?|anotac\\w*)\\b"), route: "notes", label: "as Notas" },
  { re: new RegExp("^" + ART + "(?:tarefas?\\s+pessoa\\w*|pessoal)\\b"), route: "personal", label: "o Pessoal" },
  { re: new RegExp("^" + ART + "(?:tarefas?|trabalho|prazos?)\\b"), route: "professional", label: "o Trabalho" },
  { re: new RegExp("^" + ART + "contatos\\b"), route: "contacts", label: "os Contatos" },
  { re: new RegExp("^" + ART + "aniversari\\w*"), route: "birthdays", label: "os Aniversários" },
  { re: new RegExp("^" + ART + "captura\\b"), route: "captura", label: "a Captura rápida" },
];

// "abra o processo 5001234" / "abrir cliente Maria" / "mostrar a agenda" →
// resolve aqui mesmo. Devolve { text, run } ou null (aí vai para a IA).
async function localNav(q, ctx) {
  const t = norm(q).replace(/[?!.]+$/, "").trim();
  const m = t.match(NAV_RE);
  if (!m) return null;
  const resto = t.slice(m[0].length).trim();

  // processo específico: por número ou por nome/cliente
  const mp = resto.match(/^(?:o\s+)?processo\s+(?:n[ºo°.]?\s*)?(.+)$/);
  if (mp && mp[1]) {
    try {
      const procs = await list("processes");
      const alvo = mp[1].replace(/^d[oa]\s+/, "").trim();
      const digits = alvo.replace(/\D/g, "");
      let achados = [];
      if (digits.length >= 5) achados = procs.filter((p) => (p.num || "").replace(/\D/g, "").includes(digits));
      if (!achados.length) {
        const toks = alvo.split(/\s+/).filter((w) => w.length >= 3);
        achados = toks.length ? procs.filter((p) => { const alvoTxt = norm((p.nome || "") + " " + (p.partes || "")); return toks.every((w) => alvoTxt.includes(w)); }) : [];
      }
      if (achados.length === 1) return { text: "Abrindo o processo " + (achados[0].nome || achados[0].num) + "…", run: () => ctx.openProcess(achados[0].id) };
      if (achados.length > 1) return { text: `Encontrei ${achados.length} processos parecidos — abrindo a lista para você escolher.`, run: () => ctx.navigate("processes") };
    } catch {}
    return null; // não achou → deixa a IA tentar (ela vê partes, andamentos etc.)
  }

  // cliente específico ("abrir cliente Maria" / "abrir a pasta da Liz")
  const mc = resto.match(/^(?:o\s+|a\s+)?(?:cliente\s+(?:d[oa]\s+)?|pasta\s+(?:d[oa]\s+(?:cliente\s+)?)?)(.+)$/);
  if (mc && mc[1]) {
    try {
      const clients = await list("clients");
      const toks = mc[1].replace(/^d[oa]\s+/, "").split(/\s+/).filter((w) => w.length >= 3);
      const achados = toks.length ? clients.filter((c) => { const n = norm(c.nome); return toks.every((w) => n.includes(w)); }) : [];
      if (achados.length === 1) return { text: "Abrindo a pasta de " + achados[0].nome + "…", run: () => ctx.openClient(achados[0].id) };
      if (achados.length > 1) return { text: `Encontrei ${achados.length} clientes parecidos — abrindo a lista.`, run: () => ctx.navigate("clients") };
    } catch {}
    return null;
  }

  // Um comando de abrir página é curto ("abrir a agenda"); frase comprida é
  // pergunta/ordem de verdade — vai para a IA, que entende o contexto.
  if (resto.split(/\s+/).filter(Boolean).length <= 3) {
    for (const p of PAGINAS) if (p.re.test(resto)) return { text: "Abrindo " + p.label + "…", run: () => ctx.navigate(p.route) };
  }
  return null;
}

// Busca semântica local: "aquele inventário do cliente que tinha um barco",
// "processo de alimentos da Maria", "cadê o cliente do apartamento…" → acha o
// cliente/processo por SENTIDO (sinônimos + tolerância a typo) e abre o melhor.
// Devolve { text, run } ou null (aí segue o fluxo normal). Roda offline.
async function localBusca(q, ctx) {
  const t = norm(q);
  // Não sequestra comandos de CRIAÇÃO (esses viram tarefa/nota/etc.).
  if (/^(criar?|crie|cria|nova?|novo|adicion\w*|anot\w*|lembr\w*|agend\w*|marc\w*)\b/.test(t)) return null;
  // Só entra em pedidos de BUSCA/REFERÊNCIA a um cadastro.
  if (!/(encontr\w*|\bache\b|\bacha\b|procur\w*|\bbusc\w*|\bqual\b|\bquais\b|\bonde\b|cad[eê]\b|mostr\w*|abrir|abra|abre|\bver\b|\bveja\b|processo|cliente|pasta|inventari\w*|espolio|\bcaso\b|divorci\w*|alimentos|usucapi\w*|despejo|contrato)/.test(t)) return null;

  let clients = [], processes = [];
  try { [clients, processes] = await Promise.all([list("clients"), list("processes")]); } catch { return null; }
  const nomeCli = (id) => { const c = clients.find((x) => x.id === id); return c ? c.nome : ""; };
  const docs = [
    ...clients.map((c) => ({ ref: { tipo: "cliente", r: c }, title: c.nome, text: [c.cpf, c.tel, c.email, c.endereco, c.area, c.origem, c.profissao, c.obs].filter(Boolean).join(" ") })),
    ...processes.map((p) => ({ ref: { tipo: "processo", r: p }, title: p.nome, text: [p.num, p.tipo, p.vara, p.tribunal, p.partes, p.fase, p.obs, nomeCli(p.client_id), ...(Array.isArray(p.andamentos) ? p.andamentos.map((a) => a && a.texto) : [])].filter(Boolean).join(" ") })),
  ];
  const res = rank(q, docs, { limit: 5, threshold: 0.34 });
  if (!res.length) return null;

  const best = res[0].ref;
  const outros = res.length - 1;
  const extra = outros > 0 ? ` (e mais ${outros} parecido${outros > 1 ? "s" : ""} — veja a lista)` : "";
  if (best.tipo === "cliente")
    return { text: `Achei: abrindo a pasta de ${best.r.nome}${extra}…`, run: () => ctx.openClient(best.r.id) };
  return { text: `Achei: abrindo o processo ${best.r.nome || best.r.num}${extra}…`, run: () => ctx.openProcess(best.r.id) };
}

// "faça uma procuração para a Liz" / "gerar procuração judicial do João" /
// "declaração de hipossuficiência da Maria" → abre o gerador de documentos JÁ
// preenchido (o .docx no modelo do escritório). Devolve { text, run } ou null.
async function localDocs(q, ctx) {
  const t = norm(q);
  if (!/\b(procurac\w*|declarac\w*|hipossufic\w*)\b/.test(t)) return null;
  if (!ctx.openDocumentos) return null;
  // tipo de documento
  const docs = [];
  if (/declarac\w*|hipossufic\w*/.test(t)) docs.push("declaracao");
  if (/procurac\w*/.test(t)) docs.push(/extrajud/.test(t) ? "procuracao_extrajudicial" : "procuracao_judicial");
  // cliente citado ("para/da/do/de <nome>")
  let clienteId = null, cliNome = "";
  const mc = q.match(/\b(?:para|d[oa]|de|cliente)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\-]*(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,4})/i);
  if (mc) {
    try {
      const clients = await list("clients");
      const toks = norm(mc[1]).split(/\s+/).filter((w) => w.length >= 3 && !["procuracao", "declaracao", "judicial", "extrajudicial", "hipossuficiencia"].includes(w));
      const achados = toks.length ? clients.filter((c) => { const n = norm(c.nome); return toks.every((w) => n.includes(w)); }) : [];
      if (achados.length === 1) { clienteId = achados[0].id; cliNome = achados[0].nome; }
    } catch {}
  }
  const rotulo = docs.length ? (docs.includes("declaracao") && docs.length === 1 ? "a declaração" : "a procuração") : "o gerador de documentos";
  const paraQuem = cliNome ? " de " + cliNome : "";
  return {
    text: `Abrindo ${rotulo}${paraQuem} no gerador — já no seu modelo, é só conferir e tocar em “Gerar e baixar”.`,
    run: () => ctx.openDocumentos({ clienteId, docs, objeto: "", situacao: "" }),
  };
}

// Sem IA disponível: interpreta localmente "criar tarefa/lembrete/nota/evento…"
// e propõe a ação com o mesmo cartão de confirmação.
function localCreate(q) {
  const t = norm(q);
  if (!/^(criar?|crie|cria|nova?|novo|adicion\w*|anotar?|anote|lembrar?|lembre|agendar?|agende|marcar?|marque)\b/.test(t)) return null;
  let tipo = "criar_tarefa", rotulo = "tarefa";
  if (/\blembrete|\blembrar\b|\blembre\b/.test(t)) { tipo = "criar_lembrete"; rotulo = "lembrete"; }
  else if (/\bnota\b|\banotac|\banotar\b|\banote\b/.test(t)) { tipo = "criar_nota"; rotulo = "nota"; }
  else if (/\bagend|\breuni|\baudienc|\bcompromisso|\bevento|\bmarcar\b|\bmarque\b/.test(t)) { tipo = "criar_agenda"; rotulo = "compromisso"; }
  else if (/\bcliente|\bprocesso/.test(t)) return null; // cadastro completo → melhor com IA/captura

  const semVerbo = q.replace(/^\s*(criar?|crie|cria|nova?|novo|adicion\w*|anotar?|anote|lembrar?|lembre|agendar?|agende|marcar?|marque)\s+(?:de\s+|para\s+)?(?:uma?\s+)?(?:tarefa|lembrete|nota|anotac[aã]o|compromisso|evento|reuni[aã]o|audi[êe]ncia)?\s*(?:(?:de|para|pra|que)\s+|:\s*)?/i, "").trim() || q;
  const p = parseNaturalTask(semVerbo, "pessoal") || { title: semVerbo, area: "pessoal", priority: "media", due_date: null, due_time: null };
  const quando = p.due_date ? " para " + prettyDate(p.due_date) + (p.due_time ? " às " + p.due_time : "") : "";
  const a = {
    tipo, resumo: `Criar ${rotulo} “${p.title}”${quando}`,
    titulo: p.title, area: p.area, prioridade: p.priority, data: p.due_date, hora: p.due_time,
  };
  return { text: `A IA está fora do ar, mas entendi assim: criar ${rotulo} “${p.title}”${quando}. Confirma?`, acoes: [a] };
}
