// A nova Home "IA em primeiro lugar": saudação, conversa central com o
// assistente (que responde E executa), sugestões inteligentes e o painel "Hoje".
// Toda a estrutura antiga do app continua atrás do botão ☰ Menu.

import { $, el, todayISO, prettyDate, toast } from "./ui.js";
import { list } from "./store.js";
import { assistEnabled, perguntar } from "./assist.js";
import { buildSnapshot, executarAcao, friendlyErr, rotaDePagina, acaoImediata } from "./agent.js";
import { extractTextFromFile } from "./files.js";
import { parseNaturalTask } from "./nlp.js";

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
  const prazos = pendentes.filter((t) => t.area === "profissional" && t.due_date && t.due_date <= em7 &&
    (t.priority === "alta" || t.process_id || /prazo|⏰/i.test(t.title || "")));
  const prazosHoje = prazos.filter((t) => t.due_date <= hoje);
  const lembretesHoje = reminders.filter((r) => r.remind_on === hoje);
  const compromissosHoje = pendentes.filter((t) => t.due_date === hoje && t.due_time).length + lembretesHoje.length;
  const audiencias = pendentes.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= em30 &&
    /audi[êe]nc/i.test((t.title || "") + " " + (t.description || "")))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  let pubsNovas = 0;
  try {
    const pubs = JSON.parse(localStorage.getItem(PUB_CACHE_KEY)) || [];
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
  if (pendentes.length) resumoBits.push(plural(pendentes.length, "tarefa pendente", "tarefas pendentes"));
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

  // ---- sugestões inteligentes ----
  const sugLinhas = [];
  if (pendentes.length) sugLinhas.push(plural(pendentes.length, "tarefa pendente", "tarefas pendentes"));
  if (atrasadas.length) sugLinhas.push(plural(atrasadas.length, "tarefa atrasada", "tarefas atrasadas"));
  if (prazosHoje.length) sugLinhas.push(plural(prazosHoje.length, "prazo vencendo hoje", "prazos vencendo hoje"));
  else if (prazos.length) sugLinhas.push(plural(prazos.length, "prazo nesta semana", "prazos nesta semana"));
  if (pubsNovas) sugLinhas.push(plural(pubsNovas, "publicação nova no EPROC", "publicações novas no EPROC"));
  const areaMaisPendente = pendentes.filter((t) => t.area === "profissional").length >= pendentes.filter((t) => (t.area || "pessoal") === "pessoal").length ? "professional" : "personal";
  const qbtn = (label, fn) => el("button", { class: "btn btn-sm sug-btn", onclick: fn }, label);
  const sugCard = sugLinhas.length
    ? el("div", { class: "card home-sug" }, [
        el("div", { class: "card-title" }, "Você possui"),
        el("div", { class: "sug-lines" }, sugLinhas.map((l) => el("div", { class: "sug-line" }, "•  " + l))),
        el("div", { class: "sug-actions" }, [
          pendentes.length ? qbtn("Resolver tarefas", () => ctx.navigate(areaMaisPendente)) : null,
          qbtn("Ver processos", () => ctx.navigate("processes")),
          qbtn("Abrir agenda", () => ctx.navigate("agenda")),
          qbtn("Gerar documentos", () => ctx.navigate("docs")),
          pubsNovas ? qbtn("Ver publicações", () => ctx.navigate("publicacoes")) : null,
        ].filter(Boolean)),
      ])
    : null;

  // ---- painel "Hoje" ----
  const hcard = (num, label, sub, onClick) => el("button", { class: "hoje-card", onclick: onClick }, [
    el("span", { class: "hoje-num" }, String(num)),
    el("span", { class: "hoje-lbl" }, label),
    sub ? el("span", { class: "hoje-sub" }, sub) : null,
  ]);
  const hojeCards = [
    pendentes.length ? hcard(pendentes.length, "Tarefas pendentes", atrasadas.length ? plural(atrasadas.length, "atrasada") : "", () => ctx.navigate(areaMaisPendente)) : null,
    prazos.length ? hcard(prazos.length, "Prazos processuais", prazosHoje.length ? plural(prazosHoje.length, "vence hoje", "vencem hoje") : "próximos 7 dias", () => ctx.navigate("professional")) : null,
    compromissosHoje ? hcard(compromissosHoje, "Compromissos", "para hoje", () => ctx.navigate("agenda")) : null,
    audiencias.length ? hcard(audiencias.length, "Audiências", "próxima: " + prettyDate(audiencias[0].due_date), () => ctx.navigate("agenda")) : null,
    pubsNovas ? hcard(pubsNovas, "Publicações", "movimentações recentes", () => ctx.navigate("publicacoes")) : null,
    aniversarios.length ? hcard(aniversarios.length, "Aniversários hoje", aniversarios.map((c) => (c.nome || "").split(/\s+/)[0]).slice(0, 2).join(", "), () => ctx.navigate("birthdays")) : null,
  ].filter(Boolean);
  const hojeSection = el("div", { class: "home-hoje" }, [
    el("div", { class: "hoje-title" }, "Hoje"),
    hojeCards.length
      ? el("div", { class: "hoje-grid" }, hojeCards)
      : el("div", { class: "card home-empty" }, "Nada urgente para hoje. Se quiser adiantar algo, é só me pedir aqui em cima. ✨"),
  ]);

  main.innerHTML = "";
  main.append(hero, composer, exemplos, ...[sugCard, hojeSection].filter(Boolean));

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

  // 1) Navegação simples é resolvida NA HORA, sem ir à IA (funciona até offline).
  if (!docs) {
    const nav = await localNav(q, ctx);
    if (gen !== chatGen) return;
    if (nav) {
      chat.push({ role: "assistant", text: nav.text });
      saveChat(); paintChat(ctx);
      setTimeout(nav.run, 250); // deixa a resposta aparecer antes de trocar de tela
      return;
    }
  }

  // 2) IA na nuvem (com todo o contexto do escritório).
  thinking = true; paintChat(ctx);
  let r;
  if (!assistEnabled()) r = { error: "offline" };
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
