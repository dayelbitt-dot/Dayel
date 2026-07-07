import { initSupabase, isCloud, list, insert, update, remove } from "./store.js";
import { getSession, signIn, signUp, signOut, enterLocal, onAuthChange } from "./auth.js";
import { $, $$, el, todayISO, prettyDate, openModal, closeModal, toast, asText } from "./ui.js";
import { mountCapture } from "./capture.js";
import { detectColumns, matchClient, buildProcessFromRow, parseCSV, inferGrau, extractProcessesFromText } from "./planilha.js";
import { extractTextFromFile } from "./files.js";
import { extractClient } from "./extract.js";
import { aiEnabled, aiExtract } from "./ai.js";
import { DOCS, gerarDocumentos } from "./docs.js";
import { renderHome } from "./home.js";
import { rotaDePagina } from "./agent.js";
import * as gcal from "./gcal.js";
import * as gmail from "./gmail.js";

let state = { route: "home" };
let sessionEmail = "";

// ==================== BOOTSTRAP ====================
async function boot() {
  try {
    if (isCloud()) await initSupabase();
  } catch (err) {
    $("#splash").classList.add("hidden");
    showAuth();
    const msg = $("#auth-msg");
    if (msg) { msg.className = "auth-msg error"; msg.textContent = "Não foi possível conectar à nuvem. Verifique sua internet e recarregue a página."; }
    return;
  }

  const session = await getSession();
  $("#splash").classList.add("hidden");

  if (session) showApp(session);
  else showAuth();

  onAuthChange((s) => { if (s) showApp(s); else showAuth(); });
}

function showAuth() {
  $("#app").classList.add("hidden");
  $("#auth-view").classList.remove("hidden");
  if (isCloud()) {
    $("#auth-mode-cloud").classList.remove("hidden");
    $("#auth-mode-local").classList.add("hidden");
  }
  wireAuth();
}

async function showApp(session) {
  $("#auth-view").classList.add("hidden");
  $("#app").classList.remove("hidden");
  const email = session?.user?.email || "modo local";
  sessionEmail = email;
  $("#user-chip").textContent = email;
  wireShell();
  navigate(state.route);
  // Mantém o Google Agenda conectado sozinho (renova o token em segundo plano).
  try {
    gcal.startAutoConnect((connected) => {
      if (connected) { googleLoadedKey = null; } // token novo → rebuscar eventos
      if (state.route === "agenda") renderAgenda();
    });
  } catch {}
  // Mantém o Gmail conectado sozinho (para as Publicações oficiais).
  try {
    gmail.startAutoConnect(() => { if (state.route === "publicacoes") renderPublicacoes(); });
  } catch {}
  // Ao voltar para o app (ou focar a janela), se estiver na aba de Publicações,
  // redesenha — o que dispara a rebusca automática das novas do dia.
  if (!window.__pubVisibilityWired) {
    window.__pubVisibilityWired = true;
    const revisit = () => { if (document.visibilityState === "visible" && state.route === "publicacoes") renderPublicacoes(); };
    document.addEventListener("visibilitychange", revisit);
    window.addEventListener("focus", revisit);
  }
}

// ==================== AUTH UI ====================
function wireAuth() {
  let mode = "login";
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      mode = t.dataset.tab;
      $("#auth-submit").textContent = mode === "login" ? "Entrar" : "Criar conta";
      $("#auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
    })
  );

  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const msg = $("#auth-msg");
    msg.className = "auth-msg"; msg.textContent = "Aguarde…";
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        const data = await signUp(email, password);
        if (!data.session) {
          msg.className = "auth-msg ok";
          msg.textContent = "Conta criada! Confirme pelo e-mail e depois entre.";
          return;
        }
      }
    } catch (err) {
      msg.className = "auth-msg error";
      msg.textContent = traduzErro(err);
    }
  };

  const localBtn = $("#enter-local");
  if (localBtn) localBtn.onclick = () => { enterLocal(); showApp({ user: { email: "modo local" } }); };
}

function traduzErro(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if (m.includes("already registered")) return "Este e-mail já tem conta. Tente entrar.";
  if (m.includes("password")) return "Senha precisa de pelo menos 6 caracteres.";
  return err?.message || "Algo deu errado. Tente de novo.";
}

// ==================== SHELL / ROUTER ====================
function wireShell() {
  $("#menu-btn").onclick = openDrawer;
  const backdrop = $("#drawer-backdrop");
  backdrop.onclick = (e) => { if (e.target === backdrop) closeDrawer(); };
  $$(".drawer-item").forEach((b) => { b.onclick = () => { closeDrawer(); navigate(b.dataset.route); }; });
  $("#logout-btn").onclick = async () => { closeDrawer(); await signOut(); if (!isCloud()) showAuth(); };
}

// Menu lateral (☰): guarda toda a estrutura tradicional do sistema.
let drawerTimer = null;
function openDrawer() {
  clearTimeout(drawerTimer);
  const b = $("#drawer-backdrop");
  b.classList.remove("hidden");
  void b.offsetWidth; // força o navegador a "ver" o estado fechado → a animação de abrir toca
  b.classList.add("open");
  document.body.style.overflow = "hidden"; // a página não rola atrás do menu
  if (!window.__drawerEscWired) {
    window.__drawerEscWired = true;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  }
}
function closeDrawer() {
  const b = $("#drawer-backdrop");
  if (b.classList.contains("hidden")) return;
  b.classList.remove("open");
  document.body.style.overflow = "";
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(() => b.classList.add("hidden"), 220);
}

function navigate(route) {
  if (route === "dashboard") route = "home"; // nome antigo da rota do Início
  state.route = route;
  // Contatos e Aniversários vivem "dentro" da aba Pessoal — mantêm ela destacada.
  const activeTab = (route === "contacts" || route === "birthdays") ? "personal" : route;
  $$(".drawer-item").forEach((b) => b.classList.toggle("active", b.dataset.route === activeTab));
  removeFab();
  const routes = { home: renderHomePage, captura: renderCapturaPage, agenda: renderAgenda, clients: renderClients, processes: renderProcesses, publicacoes: renderPublicacoes, docs: renderGerarDocs, personal: renderTasksPage, professional: renderTasksPage, reminders: renderReminders, notes: renderNotes, contacts: renderContacts, birthdays: renderBirthdays };
  (routes[route] || renderHomePage)();
}

function removeFab() { const f = $(".fab"); if (f) f.remove(); }
function addFab(onClick) {
  removeFab();
  document.body.append(el("button", { class: "fab", onclick: onClick }, "+"));
}
function loading() { $("#main").innerHTML = '<div class="empty">Carregando…</div>'; }

// ==================== INÍCIO (Home com IA no centro) ====================
// A Home nova vive no home.js: saudação, conversa com o assistente (que responde
// E executa), sugestões inteligentes e o painel "Hoje". Aqui só passamos o
// contexto de navegação para os cartões e as ações da IA.
function renderHomePage() {
  renderHome({
    email: sessionEmail,
    navigate,
    rotaAtual: () => state.route,
    openProcess: (id) => openProcess(id, () => navigate("home")),
    openClient: (id) => openClient(id),
    openDocumentos: (preset) => { state.route = "docs"; $$(".drawer-item").forEach((b) => b.classList.toggle("active", b.dataset.route === "docs")); renderGerarDocs(preset); },
  });
}

// Contexto que permite à IA dos chats navegar/abrir registros (ações "abrir_*").
function acaoCtx() {
  return {
    abrirPagina: (p) => navigate(rotaDePagina(p)),
    abrirProcesso: (id) => openProcess(id, () => navigate(state.route)),
    abrirCliente: (id) => openClient(id),
    abrirDocumentos: (preset) => { state.route = "docs"; $$(".drawer-item").forEach((b) => b.classList.toggle("active", b.dataset.route === "docs")); renderGerarDocs(preset); },
  };
}

// A Captura rápida multi-tipo (texto/voz/arquivos → tarefa, agenda, nota,
// cliente e processo de uma vez) continua inteira — agora como página própria.
function renderCapturaPage() {
  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", {}, [
      el("h1", { class: "page-title" }, "Captura rápida"),
      el("p", { class: "page-sub" }, "Escreva, fale ou anexe documentos — cadastre tarefa, agenda, nota, cliente e processo de uma vez"),
    ]),
    mountCapture("pessoal", () => renderCapturaPage(), acaoCtx()),
  );
  removeFab();
}

// ==================== TAREFAS (Pessoal / Profissional) ====================
async function renderTasksPage() {
  loading();
  const area = state.route === "professional" ? "profissional" : "pessoal";
  const meta = area === "profissional"
    ? { title: "Trabalho", sub: "Projetos, prazos e compromissos" }
    : { title: "Meu cadastro pessoal", sub: "Suas tarefas e prazos pessoais — só seus, fora das pastas de clientes" };
  const all = await list("tasks", { orderBy: "created_at", asc: true });
  const tasks = all.filter((t) => (t.area || "pessoal") === area);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  // Só na aba Pessoal: seção "Pessoas" (contatos + aniversários).
  let contacts = [];
  if (area === "pessoal") { try { contacts = await list("contacts", { orderBy: "nome", asc: true }); } catch {} }

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    ...[
      el("div", {}, [el("h1", { class: "page-title" }, meta.title), el("p", { class: "page-sub" }, meta.sub)]),
      area === "pessoal" ? contactsHub(contacts) : null,
      el("div", { class: "stat-grid" }, [
        stat("Abertas", String(open.length)),
        stat("Feitas", String(done.length), "pos"),
        stat("Total", String(tasks.length)),
      ]),
      el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "A fazer"),
        open.length
          ? el("div", { class: "list" }, sortTasks(open).map((t) => taskRow(t)))
          : el("div", { class: "empty" }, "Nada por aqui. Toque em + para criar."),
      ]),
      done.length
        ? el("div", { class: "card" }, [el("div", { class: "card-title" }, "Concluídas"), el("div", { class: "list" }, done.slice(-8).reverse().map((t) => taskRow(t)))])
        : null,
    ].filter(Boolean),
  );
  addFab(() => openTaskModal(area));
}

function sortTasks(tasks) {
  const rank = { alta: 0, media: 1, baixa: 2 };
  return tasks.slice().sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
  });
}

function taskRow(t, compact = false, back) {
  const today = todayISO();
  const late = t.due_date && t.due_date < today && !t.done;
  const check = el("button", { class: "check" + (t.done ? " done" : ""), title: "Concluir" }, t.done ? "✓" : "");
  check.onclick = async (e) => { e.stopPropagation(); await update("tasks", t.id, { done: !t.done, done_at: !t.done ? new Date().toISOString() : null }); refresh(); };

  const meta = [];
  if (t.due_date) meta.push((late ? "⚠ atrasada · " : "") + prettyDate(t.due_date) + (t.due_time ? " " + t.due_time : ""));
  else if (t.due_time) meta.push("🕐 " + t.due_time);
  if (t.client_id || t.process_id) meta.push((t.area === "pessoal") ? "🔒 vínculo particular" : "🔗 cliente");
  const grow = el("div", { class: "grow", onclick: () => openTask(t, back) }, [
    el("div", { class: "t1" }, t.title),
    descVisivel(t.description) ? el("div", { class: "t2" }, descVisivel(t.description)) : null,
    meta.length ? el("div", { class: "t2", style: late ? "color:var(--red)" : "" }, meta.join(" · ")) : null,
  ]);
  const children = [check, grow];
  if (!compact) {
    if (t.priority && t.priority !== "media") children.push(el("span", { class: "pill " + t.priority }, t.priority));
    children.push(el("button", { class: "del", title: "Excluir", onclick: async () => { await remove("tasks", t.id); refresh(); } }, "×"));
  }
  return el("div", { class: "row" + (t.done ? " task-done" : "") }, children);
}

async function openTaskEditModal(t, onDone) {
  const [clients, processes] = await Promise.all([list("clients", { orderBy: "nome", asc: true }), list("processes")]).catch(() => [[], []]);
  let area = t.area === "profissional" ? "profissional" : "pessoal";
  const title = el("input", { class: "form-control", value: t.title || "" });
  const desc = el("textarea", { class: "form-control", rows: "2", placeholder: "Descrição (opcional)" }, descVisivel(t.description));
  const date = el("input", { class: "form-control", type: "date", value: t.due_date || "" });
  const time = el("input", { class: "form-control", type: "time", value: t.due_time || "" });
  const prio = el("select", { class: "form-control" });
  [["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"]].forEach(([v, l]) => prio.append(el("option", { value: v, ...(v === (t.priority || "media") ? { selected: "" } : {}) }, l)));

  const segP = el("button", { type: "button", class: "seg-p" }, "Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "Trabalho");
  const seg = el("div", { class: "seg" }, [segP, segT]);
  const cliLabel = el("span"), procLabel = el("span");
  const cliHint = el("div", { class: "t2", style: "margin-top:-4px" });
  const updateLabels = () => {
    const pessoal = area === "pessoal";
    cliLabel.textContent = pessoal ? "🔒 Vincular a um cliente (opcional, só seu)" : "Cliente";
    procLabel.textContent = pessoal ? "🔒 Processo (opcional, só seu)" : "Processo";
    cliHint.textContent = pessoal ? "Vínculo só para seu controle — NÃO aparece na pasta do cliente." : "";
    cliHint.style.display = pessoal ? "block" : "none";
  };
  const paint = () => { segP.classList.toggle("active", area === "pessoal"); segT.classList.toggle("active", area === "profissional"); updateLabels(); };
  segP.onclick = () => {
    cliSel.value = ""; procSel.value = ""; fillProcs(); // zera vínculos ao virar pessoal
    area = "pessoal"; paint();
  };
  segT.onclick = () => { area = "profissional"; paint(); };
  paint();

  const cliSel = el("select", { class: "form-control" });
  cliSel.append(el("option", { value: "" }, "— nenhum —"));
  clients.forEach((c) => cliSel.append(el("option", { value: c.id, ...(t.client_id === c.id ? { selected: "" } : {}) }, c.nome)));
  const procSel = el("select", { class: "form-control" });
  const fillProcs = () => {
    const cid = cliSel.value; const atual = procSel.value;
    procSel.innerHTML = ""; procSel.append(el("option", { value: "" }, "— nenhum —"));
    const avail = processes.filter((p) => !cid || p.client_id === cid);
    avail.forEach((p) => procSel.append(el("option", { value: p.id }, p.nome)));
    procSel.value = avail.some((p) => p.id === atual) ? atual : ""; // preserva a escolha do usuário
  };
  cliSel.addEventListener("change", fillProcs);
  fillProcs();
  if (t.process_id && processes.some((p) => p.id === t.process_id)) procSel.value = t.process_id; // seleção inicial

  // ---- anexos ----
  let atts = Array.isArray(t.attachments) ? t.attachments.slice() : [];
  const attList = el("div", { class: "att-list" });
  const attInput = el("input", { type: "file", class: "hidden", multiple: "" });
  const attBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "📎 Anexar arquivo");
  const drawAtts = () => {
    attList.innerHTML = "";
    if (!atts.length) { attList.append(el("div", { class: "t2" }, "Nenhum anexo.")); return; }
    atts.forEach((a, i) => attList.append(el("div", { class: "att-item" }, [
      el("span", { class: "att-ico" }, iconForType(a.type, a.name)),
      el("span", { class: "att-name grow", onclick: () => openAttachment(a) }, a.name),
      el("span", { class: "att-size t2" }, fmtBytes(a.size)),
      el("button", { type: "button", class: "del", title: "Remover", onclick: () => { atts.splice(i, 1); drawAtts(); } }, "×"),
    ])));
  };
  attBtn.onclick = () => attInput.click();
  attInput.onchange = async () => {
    const chosen = [...attInput.files]; attInput.value = "";
    attBtn.disabled = true; attBtn.textContent = "Lendo…";
    const novos = await filesToAttachments(chosen, (m) => toast(m));
    atts = atts.concat(novos);
    attBtn.disabled = false; attBtn.textContent = "📎 Anexar arquivo";
    drawAtts();
  };
  drawAtts();
  const anexosBlock = el("div", { class: "att-block" }, [
    el("div", { class: "cap-field", style: "margin:0" }, [el("span", {}, "Anexos"), attList]),
    el("div", { style: "margin-top:6px" }, [attBtn, el("div", { class: "t2", style: "margin-top:4px" }, "Até 8 MB por arquivo (PDF, imagem, documento…).")]),
    attInput,
  ]);

  const form = el("form", {}, [
    lbl("Título", title), lbl("Descrição", desc), lbl("Área (mover)", seg),
    el("div", { class: "cap-row" }, [lbl("Data", date), lbl("Hora", time), lbl("Prioridade", prio)]),
    lbl(cliLabel, cliSel), cliHint, lbl(procLabel, procSel),
    anexosBlock,
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-danger", onclick: async () => { if (confirm("Excluir esta tarefa?")) { await remove("tasks", t.id); closeModal(); refresh(); } } }, "Excluir"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    try {
      // Preserva o marcador interno de prazo (anti-duplicata) ao salvar a edição.
      const sigOrig = sigDe(t.description);
      const descFinal = (descVisivel(desc.value) + (sigOrig ? "\n" + sigOrig : "")).trim();
      await update("tasks", t.id, {
        title: title.value.trim(), description: descFinal, area, priority: prio.value,
        due_date: date.value || null, due_time: time.value || null,
        client_id: cliSel.value || null, process_id: procSel.value || null,
        attachments: atts,
      });
    } catch (err) {
      toast("Não consegui salvar os anexos (talvez muito grandes). " + (err?.message || ""));
      return;
    }
    closeModal(); if (onDone) onDone(); else refresh();
  };
  openModal(el("div", {}, [el("h3", {}, "Editar tarefa"), form]));
  setTimeout(() => title.focus(), 50);
}

// Página de visualização (só leitura) da tarefa, com TODAS as informações
// vinculadas (cliente, processo, andamentos) e um botão Editar.
async function openTask(tOrId, backFn) {
  loading();
  const id = typeof tOrId === "object" ? tOrId.id : tOrId;
  const back = backFn || (() => navigate(state.route));
  const [tasks, clients, processes] = await Promise.all([list("tasks"), list("clients"), list("processes")]).catch(() => [[], [], []]);
  const t = tasks.find((x) => x.id === id) || (typeof tOrId === "object" ? tOrId : null);
  if (!t) { back(); return; }
  const cliente = t.client_id ? clients.find((c) => c.id === t.client_id) : null;
  const processo = t.process_id ? processes.find((p) => p.id === t.process_id) : null;
  const pessoal = (t.area || "pessoal") === "pessoal";
  const today = todayISO();
  const atrasada = t.due_date && t.due_date < today && !t.done;

  const dtHora = (iso) => { if (!iso) return ""; const d = iso.slice(0, 10); const h = iso.length > 10 ? iso.slice(11, 16) : ""; return prettyDate(d) + (h ? " às " + h : ""); };

  // ---- cabeçalho ----
  const statusTxt = t.done ? "✅ Concluída" : atrasada ? "⚠ Atrasada" : "🕓 Aberta";
  const statusCls = t.done ? "badge-encerrado" : atrasada ? "badge-suspenso" : "badge-ativo";

  // ---- detalhes ----
  const linhas = [
    ["Área", pessoal ? "Pessoal" : "Trabalho"],
    ["Prazo", t.due_date ? prettyDate(t.due_date) + (t.due_time ? " às " + t.due_time : "") : (t.due_time ? "🕐 " + t.due_time : "")],
    ["Prioridade", t.priority ? ({ alta: "🔴 Alta", media: "🟡 Média", baixa: "🟢 Baixa" }[t.priority] || t.priority) : ""],
    ["Situação", t.done ? "Concluída" : "Em aberto"],
    ["Criada em", dtHora(t.created_at)],
    ["Concluída em", t.done ? dtHora(t.done_at) : ""],
  ].filter(([, v]) => v);

  // ---- cliente vinculado ----
  let cliCard = null;
  if (cliente) {
    const cd = [
      ["CPF", cliente.cpf], ["RG", cliente.rg], ["Telefone", cliente.tel], ["E-mail", cliente.email],
      ["Nascimento", cliente.nasc ? prettyDate(cliente.nasc) : ""], ["Endereço", cliente.endereco],
      ["Área", cliente.area], ["Origem", cliente.origem],
    ].filter(([, v]) => v);
    cliCard = el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, pessoal ? "🔒 Cliente vinculado (particular)" : "👤 Cliente vinculado"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openClient(cliente.id) }, "Abrir pasta →"),
      ]),
      el("div", { class: "detail-head", style: "margin-bottom:10px" }, [
        avatar(cliente.nome),
        el("div", {}, [el("div", { class: "t1", style: "font-weight:700" }, cliente.nome), pessoal ? el("div", { class: "t2" }, "Vínculo só seu — não aparece na pasta do cliente.") : null]),
      ]),
      cd.length ? el("dl", { class: "kv" }, cd.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      cliente.obs ? el("div", { class: "t2", style: "margin-top:8px; white-space:pre-wrap" }, "📝 " + cliente.obs) : null,
    ]);
  }

  // ---- processo vinculado ----
  let procCard = null;
  if (processo) {
    const pl = [
      ["Número", processo.num], ["Grau", processo.grau === "2" ? "2º grau" : "1º grau"],
      ["Tipo de ação", processo.tipo], ["Vara / Juízo", processo.vara], ["Tribunal", processo.tribunal],
      ["Partes contrárias", processo.partes], ["Fase atual", processo.fase],
      ["Valor da causa", processo.valor != null ? BRLnum(processo.valor) : ""],
      ["Status", processo.status || "Ativo"],
    ].map(([k, v]) => [k, asText(v)]).filter(([, v]) => v);
    const ands = Array.isArray(processo.andamentos) ? processo.andamentos : [];
    const tl = el("div", { class: "timeline" });
    ands.slice(-3).reverse().forEach((a) => tl.append(el("div", { class: "and-item" }, [
      el("div", { class: "and-dot" }),
      el("div", { class: "and-body" }, [
        el("div", { class: "and-when" }, (a.data ? prettyDate(a.data) : "") + (a.hora ? " às " + a.hora : "")),
        el("div", { class: "and-text" }, a.texto || ""),
      ]),
    ])));
    procCard = el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, "⚖️ Processo vinculado"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openProcess(processo.id, () => openTask(id, back)) }, "Abrir processo →"),
      ]),
      el("div", { class: "t1", style: "font-weight:700; margin-bottom:6px" }, processo.nome),
      pl.length ? el("dl", { class: "kv" }, pl.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      processo.obs ? el("div", { class: "t2", style: "margin-top:8px; white-space:pre-wrap" }, "📝 " + processo.obs) : null,
      ands.length ? el("div", { class: "card-title", style: "margin-top:12px" }, `Últimos andamentos (${ands.length})`) : null,
      ands.length ? tl : null,
    ]);
  }

  const toggleDone = async () => { await update("tasks", id, { done: !t.done, done_at: !t.done ? new Date().toISOString() : null }); openTask(id, back); };

  // ---- anexos (com adicionar/baixar/remover direto na página) ----
  const anexos = Array.isArray(t.attachments) ? t.attachments : [];
  const attInput = el("input", { type: "file", class: "hidden", multiple: "" });
  const addAtt = el("button", { class: "btn btn-ghost btn-sm", onclick: () => attInput.click() }, "📎 Anexar");
  attInput.onchange = async () => {
    const chosen = [...attInput.files]; attInput.value = "";
    addAtt.disabled = true; addAtt.textContent = "Lendo…";
    const novos = await filesToAttachments(chosen, (m) => toast(m));
    if (novos.length) { try { await update("tasks", id, { attachments: anexos.concat(novos) }); } catch (e) { toast("Não consegui salvar (arquivo grande?). " + (e?.message || "")); } }
    openTask(id, back);
  };
  const removeAtt = async (i) => {
    const rest = anexos.slice(); rest.splice(i, 1);
    await update("tasks", id, { attachments: rest }); openTask(id, back);
  };
  const attCard = el("div", { class: "card" }, [
    el("div", { class: "section-head", style: "margin-bottom:10px" }, [
      el("div", { class: "card-title", style: "margin:0" }, `📎 Anexos (${anexos.length})`),
      addAtt,
    ]),
    anexos.length
      ? el("div", { class: "att-list" }, anexos.map((a, i) => el("div", { class: "att-item" }, [
          el("span", { class: "att-ico" }, iconForType(a.type, a.name)),
          el("span", { class: "att-name grow", onclick: () => openAttachment(a) }, a.name),
          el("span", { class: "att-size t2" }, fmtBytes(a.size)),
          el("button", { class: "btn btn-ghost btn-sm", onclick: () => openAttachment(a), title: "Baixar" }, "⤓"),
          el("button", { class: "del", title: "Remover", onclick: () => removeAtt(i) }, "×"),
        ])))
      : el("div", { class: "t2" }, "Nenhum arquivo anexado. Toque em Anexar."),
    attInput,
  ]);

  const main = $("#main");
  main.innerHTML = "";
  main.append(...[
    el("button", { class: "back-btn", onclick: back }, "← Voltar"),
    el("div", { class: "section-head", style: "align-items:flex-start" }, [
      el("div", {}, [
        el("h1", { class: "page-title", style: "font-size:19px" }, t.title),
        el("p", { class: "page-sub" }, pessoal ? "🧑 Tarefa pessoal" : "💼 Tarefa de trabalho"),
      ]),
      el("span", { class: "badge " + statusCls }, statusTxt),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, "Detalhes"),
        el("button", { class: "btn btn-primary btn-sm", onclick: () => openTaskEditModal(t, () => openTask(id, back)) }, "✏️ Editar"),
      ]),
      descVisivel(t.description) ? el("div", { class: "detail-desc", style: "white-space:pre-wrap; margin-bottom:12px" }, descVisivel(t.description)) : el("div", { class: "t2", style: "margin-bottom:12px" }, "Sem descrição. Toque em Editar para adicionar."),
      linhas.length ? el("dl", { class: "kv" }, linhas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
    ]),
    cliCard,
    procCard,
    attCard,
    el("div", { class: "detail-actions", style: "display:flex; gap:8px; margin-top:6px" }, [
      el("button", { class: "btn btn-block " + (t.done ? "btn-ghost" : "btn-primary"), onclick: toggleDone }, t.done ? "↩ Reabrir" : "✓ Concluir"),
      el("button", { class: "btn btn-danger btn-block", onclick: async () => { if (confirm("Excluir esta tarefa?")) { await remove("tasks", id); back(); } } }, "Excluir"),
    ]),
  ].filter(Boolean));
  removeFab();
}

function openTaskModal(area) {
  const title = el("input", { type: "text", placeholder: "O que precisa ser feito?", required: "" });
  const prio = el("select", {}, ["media"].map(() => null));
  prio.innerHTML = "";
  [["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"]].forEach(([v, l]) => prio.append(el("option", { value: v, ...(v === "media" ? { selected: "" } : {}) }, l)));
  const due = el("input", { type: "date" });

  const form = el("form", {}, [
    el("label", {}, ["Tarefa", title]),
    el("label", {}, ["Prioridade", prio]),
    el("label", {}, ["Prazo (opcional)", due]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Adicionar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    await insert("tasks", { title: title.value.trim(), area, priority: prio.value, due_date: due.value || null, done: false });
    closeModal(); renderTasksPage();
  };
  openModal(el("div", {}, [el("h3", {}, area === "profissional" ? "Nova tarefa de trabalho" : "Nova tarefa"), form]));
  setTimeout(() => title.focus(), 50);
}

// ==================== AGENDA / CALENDÁRIO ====================
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
let agendaState = null; // { year, month, selected }
// Cache de eventos do Google, carregado em segundo plano (NUNCA bloqueia o desenho da Agenda)
let googleEvents = [];
let googleLoadedKey = null;   // chave "ano-mês" já carregada, evita recarregar à toa
let googleLoading = false;
let googleSilentAt = 0; // quando tentamos a última reconexão silenciosa (cooldown)

function dateToISO(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
const HH = 48; // altura de 1 hora, em px
function minutesOf(hhmm) { if (!hhmm) return null; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function fmtMin(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }

async function renderAgenda() {
  loading();
  const [tasks, reminders] = await Promise.all([list("tasks"), list("reminders")]);
  const today = todayISO();
  if (!agendaState || agendaState.month == null) { const d = new Date(); agendaState = { year: d.getFullYear(), month: d.getMonth(), selected: today }; }

  // eventos por data
  const ev = {};
  const allEvents = [];
  const push = (iso, e) => { if (!iso) return; const rec = { ...e, date: iso }; (ev[iso] = ev[iso] || []).push(rec); allEvents.push(rec); };
  tasks.filter((t) => !t.done).forEach((t) => push(t.due_date, { kind: t.area === "profissional" ? "work" : "personal", title: t.title, time: t.due_time, start: minutesOf(t.due_time), allDay: !t.due_time, raw: t }));
  reminders.forEach((r) => push(r.remind_on, { kind: "reminder", title: r.title, time: null, start: null, allDay: true, raw: r }));

  const { year, month } = agendaState;
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());

  // Google Agenda: NÃO bloqueia o desenho. Usa o cache já carregado (se houver)
  // e dispara o carregamento em segundo plano (ensureGoogleEvents, no fim).
  let gStatus = "off";
  if (gcal.googleEnabled()) {
    gStatus = gcal.isConnected() ? "connected" : (googleLoading ? "loading" : "connect");
    if (gcal.isConnected()) {
      googleEvents.forEach((x) => push(x.date, { kind: "gcal", title: x.title, time: x.time, start: minutesOf(x.time), allDay: !x.time, location: x.location, htmlLink: x.htmlLink }));
    }
  }

  // calendário mensal
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const go = (delta) => { const d = new Date(year, month + delta, 1); agendaState.year = d.getFullYear(); agendaState.month = d.getMonth(); renderAgenda(); };
  const head = el("div", { class: "cal-head" }, [
    el("div", { class: "cal-title" }, `${cap(MESES[month])} ${year}`),
    el("div", { class: "cal-nav" }, [
      el("button", { onclick: () => go(-1), title: "Mês anterior" }, "‹"),
      el("button", { onclick: () => { const d = new Date(); agendaState = { year: d.getFullYear(), month: d.getMonth(), selected: today }; renderAgenda(); }, style: "width:auto;padding:0 10px;font-size:13px;font-weight:700" }, "Hoje"),
      el("button", { onclick: () => go(1), title: "Próximo mês" }, "›"),
    ]),
  ]);
  const grid = el("div", { class: "cal-grid" }, DOW.map((d) => el("div", { class: "cal-dow" }, d)));
  for (let i = 0; i < 42; i++) {
    const cd = new Date(gridStart); cd.setDate(gridStart.getDate() + i);
    const iso = dateToISO(cd);
    const items = ev[iso] || [];
    const dots = el("div", { class: "cal-dots" });
    const kinds = new Set(items.map((x) => x.kind === "reminder" ? "reminder" : x.kind === "gcal" ? "gcal" : (iso < today ? "late" : "task")));
    [...kinds].slice(0, 3).forEach((k) => dots.append(el("div", { class: "cal-dot " + k })));
    const cls = ["cal-cell"];
    if (cd.getMonth() !== month) cls.push("other");
    if (iso === today) cls.push("today");
    if (iso === agendaState.selected) cls.push("selected");
    grid.append(el("div", { class: cls.join(" "), onclick: () => { agendaState.selected = iso; renderAgenda(); } }, [
      el("div", { class: "num" }, String(cd.getDate())),
      dots,
    ]));
  }

  // lista cronológica de TODOS os compromissos (de hoje em diante)
  const futuros = allEvents.filter((e) => e.date >= today).sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : ((a.start ?? -1) - (b.start ?? -1)));
  const chrono = el("div", { class: "list" });
  let curDate = null;
  for (const e of futuros) {
    if (e.date !== curDate) {
      curDate = e.date;
      const dd = new Date(e.date + "T00:00:00");
      const lbl = e.date === today ? "Hoje" : `${DOW[dd.getDay()]}, ${dd.getDate()} de ${MESES[dd.getMonth()]}`;
      chrono.append(el("div", { class: "group-head" }, lbl));
    }
    chrono.append(chronoRow(e));
  }

  const main = $("#main");
  main.innerHTML = "";
  main.append(...[
    el("div", {}, [el("h1", { class: "page-title" }, "Agenda"), el("p", { class: "page-sub" }, "Calendário e todos os compromissos")]),
    googleBar(gStatus),
    el("div", { class: "card" }, [head, grid]),
    el("div", { class: "agenda-day" }, "Todos os compromissos"),
    futuros.length ? chrono : el("div", { class: "empty" }, "Nenhum compromisso agendado."),
  ].filter(Boolean));
  addFab(() => openAgendaAdd(agendaState.selected || today));

  // Carrega o Google em segundo plano (nunca trava a tela). Ao terminar, redesenha.
  if (gcal.googleEnabled()) ensureGoogleEvents(gridStart, year, month);
}

// Reconecta em silêncio e busca eventos do mês visível — tudo assíncrono,
// sem travar a Agenda. Quando os dados chegam, redesenha só se ainda na Agenda.
// A reconexão silenciosa (prompt:'none') NÃO abre pop-up: se o Google já foi
// autorizado uma vez e há sessão no navegador, o token é renovado sozinho.
async function ensureGoogleEvents(gridStart, year, month) {
  const key = year + "-" + month;
  if (googleLoading) return;
  const redraw = () => { if (state.route === "agenda") renderAgenda(); };

  // Não conectado (nunca ou token de 1h expirou): tenta renovar em silêncio.
  // Com cooldown de 20s para não repetir à toa, mas SEM limite por sessão —
  // assim continua vinculado sem você precisar clicar de novo.
  if (!gcal.isConnected()) {
    if (!gcal.wasLinked()) return;
    if (Date.now() - googleSilentAt < 20000) return;
    googleSilentAt = Date.now();
    googleLoading = true;
    try { await gcal.connect(false); } catch {}
    googleLoading = false;
    if (!gcal.isConnected()) { redraw(); return; }
    googleLoadedKey = null; // reconectou → força rebuscar o mês
    // segue para a busca
  }

  // Conectado e este mês já carregado → nada a fazer.
  if (googleLoadedKey === key) return;

  googleLoading = true;
  redraw(); // mostra o estado "carregando" na barra do Google
  try {
    const rEnd = new Date(gridStart); rEnd.setDate(rEnd.getDate() + 42);
    googleEvents = await gcal.listEvents(gridStart.toISOString(), rEnd.toISOString());
    googleLoadedKey = key;
  } catch { /* silencioso: mantém o cache anterior */ }
  finally {
    googleLoading = false;
    redraw();
  }
}

function openEvent(e) {
  if (e.kind === "gcal") { openGoogleEvent(e); return; }
  if (e.kind === "reminder") { navigate("reminders"); return; }
  if (e.raw) openTask(e.raw, renderAgenda);
}

// Detalhes de um evento do Google Agenda (sem sair do app).
// Só abre o Google se o usuário tocar em "Abrir no Google Agenda".
function openGoogleEvent(e) {
  const dd = e.date ? new Date(e.date + "T00:00:00") : null;
  const dataTxt = dd ? `${DOW[dd.getDay()]}, ${dd.getDate()} de ${MESES[dd.getMonth()]} de ${dd.getFullYear()}` : "";
  const horaTxt = e.allDay || !e.time ? "Dia todo" : (e.time + (e.endTime ? " – " + e.endTime : ""));
  const linhas = [
    ["Data", dataTxt], ["Horário", horaTxt], ["Local", e.location || ""],
  ].filter(([, v]) => v);
  const body = el("div", {}, [
    el("h3", { style: "margin-bottom:4px" }, e.title || "(sem título)"),
    el("p", { class: "page-sub", style: "margin-top:0" }, "📅 Google Agenda"),
    linhas.length ? el("dl", { class: "kv" }, linhas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Fechar"),
      e.htmlLink ? el("button", { type: "button", class: "btn btn-primary", onclick: () => window.open(e.htmlLink, "_blank") }, "Abrir no Google Agenda ↗") : null,
    ].filter(Boolean)),
  ].filter(Boolean));
  openModal(body);
}

function chronoRow(e) {
  const when = e.allDay ? el("span", { class: "agenda-time allday" }, "dia todo") : el("span", { class: "agenda-time" }, fmtMin(e.start));
  const tag = e.kind === "reminder" ? "🔔 lembrete" : e.kind === "gcal" ? "📅 Google" : e.kind === "work" ? "💼 trabalho" : "🧑 pessoal";
  return el("div", { class: "row agenda-item", onclick: () => openEvent(e) }, [
    when,
    el("div", { class: "grow" }, [el("div", { class: "t1" }, e.title), e.location ? el("div", { class: "t2" }, "📍 " + e.location) : null]),
    el("span", { class: "pill" }, tag),
  ]);
}

function googleBar(status) {
  if (status === "off") return null;
  if (status === "loading")
    return el("div", { class: "gbar" }, [
      el("span", { class: "t2" }, "🔄 Sincronizando com o Google Agenda…"),
    ]);
  if (status === "connect")
    return el("div", { class: "gbar" }, [
      el("span", { class: "t2" }, "Veja e crie eventos do seu Google Agenda aqui."),
      el("button", { class: "btn btn-sm btn-primary", onclick: async () => {
        try { await gcal.connect(true); renderAgenda(); } catch (e) { toast("Não foi possível conectar ao Google. " + (e.message || "")); }
      } }, "🔗 Conectar Google"),
    ]);
  if (status === "error")
    return el("div", { class: "gbar" }, [
      el("span", { class: "t2" }, "Sessão do Google expirou."),
      el("button", { class: "btn btn-sm", onclick: async () => { try { await gcal.connect(true); renderAgenda(); } catch {} } }, "Reconectar"),
    ]);
  return el("div", { class: "gbar" }, [
    el("span", { class: "t2" }, "✅ Google Agenda conectado"),
    el("button", { class: "btn btn-sm btn-ghost", onclick: () => { gcal.disconnect(); renderAgenda(); } }, "Desconectar"),
  ]);
}


function openAgendaAdd(dateISO) {
  const title = el("input", { class: "form-control", placeholder: "O que é?", required: "" });
  const date = el("input", { class: "form-control", type: "date", value: dateISO || todayISO() });
  const time = el("input", { class: "form-control", type: "time" });
  const tipo = el("select", { class: "form-control" });
  [["pessoal", "Tarefa pessoal"], ["profissional", "Tarefa de trabalho"], ["lembrete", "Lembrete"]].forEach(([v, l]) => tipo.append(el("option", { value: v }, l)));
  const gChk = el("input", { type: "checkbox" });
  const gRow = gcal.isConnected()
    ? el("label", { style: "flex-direction:row; align-items:center; gap:8px; font-size:13px; color:var(--text)" }, [gChk, "📅 Criar também no Google Agenda"])
    : null;
  const form = el("form", {}, [
    el("label", {}, ["O que é?", title]),
    el("div", { class: "cap-row" }, [lbl("Data", date), lbl("Hora (opcional)", time), lbl("Tipo", tipo)]),
    gRow,
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Adicionar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    const dISO = date.value || todayISO();
    if (tipo.value === "lembrete") await insert("reminders", { title: title.value.trim(), body: "", remind_on: dISO });
    else await insert("tasks", { title: title.value.trim(), area: tipo.value, priority: "media", due_date: dISO, due_time: time.value || null, done: false });
    if (gRow && gChk.checked) {
      try { await gcal.createEvent({ title: title.value.trim(), date: dISO, time: time.value || null }); toast("📅 Também criado no Google Agenda."); }
      catch (err) { toast("Salvo aqui, mas falhou no Google: " + (err.message || "")); }
    }
    closeModal(); renderAgenda();
  };
  openModal(el("div", {}, [el("h3", {}, "Novo compromisso"), form]));
  setTimeout(() => title.focus(), 50);
}

// ==================== LEMBRETES GERAIS ====================
// Ordenados por data (ordem cronológica): os mais próximos primeiro.
function sortReminders(list) {
  return list.slice().sort((a, b) => {
    if (!a.remind_on && !b.remind_on) return (a.created_at < b.created_at ? 1 : -1);
    if (!a.remind_on) return 1;   // sem data vai para o fim
    if (!b.remind_on) return -1;
    return a.remind_on < b.remind_on ? -1 : (a.remind_on > b.remind_on ? 1 : 0);
  });
}

async function renderReminders() {
  loading();
  const all = sortReminders(await list("reminders"));
  const today = todayISO();

  // agrupa em blocos cronológicos
  const groups = [
    { key: "atrasado", label: "⚠️ Atrasados", items: [] },
    { key: "hoje", label: "📌 Hoje", items: [] },
    { key: "semana", label: "🗓️ Próximos 7 dias", items: [] },
    { key: "futuro", label: "🔮 Mais adiante", items: [] },
    { key: "semdata", label: "📎 Sem data", items: [] },
  ];
  const in7 = addDaysISO(today, 7);
  for (const r of all) {
    if (!r.remind_on) groups[4].items.push(r);
    else if (r.remind_on < today) groups[0].items.push(r);
    else if (r.remind_on === today) groups[1].items.push(r);
    else if (r.remind_on <= in7) groups[2].items.push(r);
    else groups[3].items.push(r);
  }

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", {}, [
      el("h1", { class: "page-title" }, "Lembretes"),
      el("p", { class: "page-sub" }, "Tudo que você precisa lembrar, em ordem cronológica"),
    ]),
  );
  if (!all.length) {
    main.append(el("div", { class: "empty" }, "Nenhum lembrete ainda. Toque em + para adicionar."));
  } else {
    for (const g of groups) {
      if (!g.items.length) continue;
      main.append(
        el("div", { class: "group-head" }, g.label),
        el("div", { class: "list" }, g.items.map((r) => reminderRow(r))),
      );
    }
  }
  addFab(() => openReminderModal());
}

function reminderRow(r, compact = false) {
  const today = todayISO();
  const late = r.remind_on && r.remind_on < today;
  const children = [
    el("div", { class: "grow", onclick: compact ? undefined : () => openReminderModal(r) }, [
      el("div", { class: "t1" }, r.title || "Lembrete"),
      r.body ? el("div", { class: "t2", style: "white-space:pre-wrap; margin-top:2px" }, r.body) : null,
      r.remind_on
        ? el("div", { class: "t2", style: "margin-top:4px;" + (late ? "color:var(--red)" : "color:var(--accent)") }, "📅 " + prettyDate(r.remind_on) + (late ? " · atrasado" : ""))
        : null,
    ]),
  ];
  if (!compact) {
    children.push(el("button", { class: "del", title: "Excluir", onclick: async (e) => { e.stopPropagation(); if (confirm("Excluir este lembrete?")) { await remove("reminders", r.id); renderReminders(); } } }, "×"));
  }
  return el("div", { class: "row reminder-row" }, children);
}

function openReminderModal(existing) {
  const r = existing || {};
  const title = el("input", { type: "text", placeholder: "Sobre o que é o lembrete?", required: "", value: r.title || "" });
  const body = el("textarea", { rows: "4", placeholder: "Detalhes importantes (opcional)…" }, r.body || "");
  const date = el("input", { type: "date", value: r.remind_on || todayISO() });

  const actions = [];
  if (existing) actions.push(el("button", { type: "button", class: "btn btn-danger", onclick: async () => { if (confirm("Excluir este lembrete?")) { await remove("reminders", existing.id); closeModal(); renderReminders(); } } }, "Excluir"));
  else actions.push(el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"));
  actions.push(el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"));

  const form = el("form", {}, [
    el("label", {}, ["Título", title]),
    el("label", {}, ["Data", date]),
    el("label", {}, ["Informações (opcional)", body]),
    el("div", { class: "modal-actions" }, actions),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    const data = { title: title.value.trim(), body: body.value.trim(), remind_on: date.value || null };
    if (existing) await update("reminders", existing.id, data);
    else await insert("reminders", data);
    closeModal(); renderReminders();
  };
  openModal(el("div", {}, [el("h3", {}, existing ? "Editar lembrete" : "Novo lembrete"), form]));
  setTimeout(() => title.focus(), 50);
}

// ==================== NOTAS ====================
async function renderNotes() {
  loading();
  const notes = await list("notes");
  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", {}, [el("h1", { class: "page-title" }, "Notas"), el("p", { class: "page-sub" }, "Ideias, anotações e lembretes")]),
    notes.length
      ? el("div", { class: "list" }, notes.map(noteRow))
      : el("div", { class: "empty" }, "Nenhuma nota ainda. Toque em + para criar."),
  );
  addFab(() => openNoteModal());
}

function noteRow(n) {
  const del = el("button", { class: "del", title: "Excluir" }, "×");
  del.onclick = async (e) => { e.stopPropagation(); if (confirm("Excluir esta nota?")) { await remove("notes", n.id); renderNotes(); } };
  return el("div", { class: "card", style: "padding:14px; cursor:pointer", onclick: () => openNoteModal(n) }, [
    el("div", { class: "section-head" }, [
      el("div", { class: "t1", style: "font-weight:700" }, n.title || "Sem título"),
      del,
    ]),
    n.body ? el("div", { class: "t2", style: "margin-top:6px; white-space:pre-wrap; line-height:1.5" }, n.body) : null,
    el("div", { class: "t2", style: "margin-top:8px; opacity:.7" }, "Toque para editar · " + prettyDate(n.created_at)),
  ]);
}

function openNoteModal(existing) {
  const f = existing || {};
  const title = el("input", { type: "text", placeholder: "Título", value: f.title || "" });
  const body = el("textarea", { rows: "6", placeholder: "Escreva aqui…" }, f.body || "");
  const form = el("form", {}, [
    el("label", {}, ["Título", title]),
    el("label", {}, ["Conteúdo", body]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim() && !body.value.trim()) { closeModal(); return; }
    const data = { title: title.value.trim(), body: body.value.trim() };
    if (existing) await update("notes", existing.id, data);
    else await insert("notes", data);
    closeModal(); renderNotes();
  };
  openModal(el("div", {}, [el("h3", {}, existing ? "Editar nota" : "Nova nota"), form]));
  setTimeout(() => title.focus(), 50);
}

// ==================== CLIENTES ====================
const AVATAR_CORES = ["#3D4F72", "#4A5C2E", "#6B7FA3", "#B8872A", "#5B3FA3", "#1A6B5A", "#3f6fe0", "#0e8fd4"];
const TIPOS = ["Família", "Inventário", "Divórcio", "Alimentos / Revisional", "Guarda", "Danos morais", "Cobrança", "Civil", "Outro"];
const TRIBUNAIS = ["1ª Instância", "TJRS", "STJ", "STF", "TRT"];
const FASES = ["Petição inicial", "Citação", "Contestação", "Instrução", "Sentença", "Recurso", "Execução", "Encerrado"];
const STATUS = ["Ativo", "Suspenso", "Encerrado"];

function iniciais(nome) {
  const p = (nome || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function corAvatar(str) {
  let h = 0; for (const c of str || "") h = (h * 31 + c.charCodeAt(0)) % AVATAR_CORES.length;
  return AVATAR_CORES[h];
}
function avatar(nome) {
  return el("div", { class: "avatar", style: `background:${corAvatar(nome)}` }, iniciais(nome));
}

async function renderClients() {
  loading();
  const clients = (await list("clients", { orderBy: "nome", asc: true }));
  const main = $("#main");
  main.innerHTML = "";
  const search = el("input", { class: "search-box", type: "search", placeholder: "🔎 Buscar por nome ou CPF…" });
  const listWrap = el("div", { class: "list" });
  const draw = (q = "") => {
    const f = q.trim().toLowerCase();
    const rows = clients.filter((c) => !f || (c.nome || "").toLowerCase().includes(f) || (c.cpf || "").includes(f));
    listWrap.innerHTML = "";
    if (!rows.length) { listWrap.append(el("div", { class: "empty" }, clients.length ? "Nenhum cliente encontrado." : "Nenhum cliente ainda. Toque em + para cadastrar.")); return; }
    rows.forEach((c) => listWrap.append(clientCard(c)));
  };
  search.addEventListener("input", () => draw(search.value));
  const importInput = el("input", { type: "file", class: "hidden" });
  importInput.addEventListener("change", async () => {
    const f = importInput.files[0]; importInput.value = "";
    if (!f) return;
    const nome = f.name.toLowerCase();
    if (/\.json$/.test(nome)) await importarBackup(f);
    else if (/\.(xlsx|xls|csv)$/.test(nome)) await importarPlanilha(f);
    else await importarArquivoLivre(f); // PDF, imagem, txt, doc… (leitura por texto)
  });
  main.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [el("h1", { class: "page-title" }, "Clientes"), el("p", { class: "page-sub" }, `${clients.length} cadastrado${clients.length === 1 ? "" : "s"}`)]),
      el("div", { style: "display:flex; gap:6px; flex-shrink:0" }, [
        el("button", { class: "btn btn-ghost btn-sm", onclick: openImportsManager, title: "Desfazer importações" }, "↩︎"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openBackupClientes(clients), title: "Backup / exportar todos os dados (para guardar ou análise)" }, "⬇ Exportar"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => importInput.click() }, "⬆ Importar"),
      ]),
    ]),
    importInput, search, listWrap,
  );
  draw();
  addFab(() => openClientModal());
}

// Baixa um arquivo (blob) com o nome dado.
function baixarArquivo(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function backupData() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Colunas amigáveis da planilha de clientes.
function clienteParaLinha(c) {
  return {
    "Nome": c.nome || "", "CPF/CNPJ": c.cpf || "", "RG": c.rg || "",
    "Telefone": c.tel || "", "E-mail": c.email || "", "Nascimento": c.nasc || "",
    "Endereço": c.endereco || "", "Nacionalidade": c.nacionalidade || "",
    "Estado civil": c.estado_civil || "", "Profissão": c.profissao || "",
    "Área": c.area || "", "Origem": c.origem || "", "Observações": c.obs || "",
  };
}
async function exportClientsJSON(clients) {
  const payload = { app: "Meu Assistente", tipo: "backup-clientes", exportado_em: new Date().toISOString(), total: clients.length, clientes: clients };
  baixarArquivo(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `clientes-${backupData()}.json`);
}
async function exportClientsXLSX(clients) {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet(clients.map(clienteParaLinha));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  baixarArquivo(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `clientes-${backupData()}.xlsx`);
}

// Exporta TODOS os dados do sistema num único JSON (para backup ou análise).
// Remove anexos (arquivos embutidos) para o arquivo ficar leve.
async function exportarTudo() {
  const tabelas = ["clients", "processes", "tasks", "notes", "reminders", "contacts"];
  const semAnexos = (r) => { const { attachments, ...rest } = r || {}; return rest; };
  const dump = { app: "Meu Assistente", versao: 1, exportadoEm: new Date().toISOString(), tabelas: {} };
  const contagem = {};
  for (const t of tabelas) {
    try { const rows = await list(t); dump.tabelas[t] = (rows || []).map(semAnexos); contagem[t] = dump.tabelas[t].length; }
    catch { dump.tabelas[t] = []; contagem[t] = 0; }
  }
  baixarArquivo(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }), `dados-assistente-${backupData()}.json`);
  return contagem;
}

// Modal de backup / exportação de dados.
function openBackupClientes(clients) {
  clients = clients || [];
  const doExcel = el("button", { class: "btn btn-block" + (clients.length ? "" : " btn-ghost"), disabled: clients.length ? null : "" }, "⬇ Clientes em Excel (.xlsx)");
  const doJson = el("button", { class: "btn btn-block", disabled: clients.length ? null : "" }, "⬇ Clientes em JSON (.json)");
  const doTudo = el("button", { class: "btn btn-primary btn-block" }, "⬇ Exportar TODOS os dados (JSON)");
  doExcel.onclick = async () => {
    doExcel.disabled = true; doExcel.textContent = "Gerando planilha…";
    try { await exportClientsXLSX(clients); toast("✅ Planilha gerada. Verifique os downloads."); closeModal(); }
    catch (e) { doExcel.disabled = false; doExcel.textContent = "⬇ Clientes em Excel (.xlsx)"; toast("Não consegui gerar o Excel (a 1ª vez precisa de internet): " + (e?.message || "")); }
  };
  doJson.onclick = async () => {
    try { await exportClientsJSON(clients); toast("✅ Arquivo JSON gerado. Verifique os downloads."); closeModal(); }
    catch (e) { toast("Não consegui gerar o JSON: " + (e?.message || "")); }
  };
  doTudo.onclick = async () => {
    doTudo.disabled = true; doTudo.textContent = "Exportando…";
    try {
      const c = await exportarTudo();
      toast(`✅ Exportado: ${c.clients} clientes · ${c.processes} processos · ${c.tasks} tarefas. Verifique os downloads.`, { duration: 9000 });
      closeModal();
    } catch (e) { doTudo.disabled = false; doTudo.textContent = "⬇ Exportar TODOS os dados (JSON)"; toast("Não consegui exportar: " + (e?.message || "")); }
  };
  openModal(el("div", {}, [
    el("h3", {}, "Backup e exportação"),
    el("p", { class: "page-sub", style: "margin:0 0 14px" }, "Baixe uma cópia dos seus dados para guardar, levar para outro sistema ou enviar para análise."),
    el("div", { style: "display:flex; flex-direction:column; gap:10px" }, [
      doTudo,
      el("p", { class: "t2", style: "margin:0" }, "“Exportar TODOS os dados” gera um único arquivo .json com clientes, processos, tarefas, notas, lembretes e contatos (sem os arquivos anexados). É o ideal para me enviar e eu analisar os vínculos/cadastros."),
      el("div", { style: "height:6px" }),
      doExcel, doJson,
      el("p", { class: "t2", style: "margin:2px 0 0" }, "O JSON de clientes pode ser reimportado aqui depois (botão Importar). ⚠️ Os arquivos contêm dados pessoais (CPF etc.) — guarde/compartilhe com cuidado."),
    ]),
    el("div", { class: "modal-actions" }, [el("button", { class: "btn btn-ghost", onclick: closeModal }, "Fechar")]),
  ]));
}

// Importa um backup .json exportado do sistema DB Advocacia
async function importarBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast("Arquivo inválido — envie o backup .json do DB Advocacia."); return; }

  const clientes = data.clientes || data.clients || [];
  const processos = data.processos || data.processes || [];
  if (!clientes.length && !processos.length) { toast("Nenhum cliente ou processo encontrado no arquivo."); return; }

  const nn = (v) => { const s = (v ?? "").toString().trim(); return s || null; };
  toast(`Importando ${clientes.length} clientes e ${processos.length} processos… aguarde.`, { duration: 120000 });

  const idMap = {}; let okC = 0, okP = 0;
  for (const c of clientes) {
    try {
      const saved = await insert("clients", {
        nome: nn(c.nome) || "(sem nome)", cpf: nn(c.cpf), rg: nn(c.rg), tel: nn(c.tel), email: nn(c.email),
        nasc: nn(c.nasc), endereco: nn(c.end) || nn(c.endereco), area: nn(c.area), origem: nn(c.origem), obs: nn(c.obs),
      });
      if (saved) { idMap[c.id] = saved.id; okC++; }
    } catch {}
  }
  for (const p of processos) {
    try {
      await insert("processes", {
        num: nn(p.num), nome: nn(p.nome) || "(sem descrição)", client_id: idMap[p.clienteId] || null,
        tipo: nn(p.tipo), vara: nn(p.vara), tribunal: nn(p.tribunal), partes: nn(p.partes),
        data_distribuicao: nn(p.data) || nn(p.data_distribuicao), fase: nn(p.fase), status: nn(p.status) || "Ativo",
        valor: p.valor ? (parseFloat(p.valor) || null) : null, obs: nn(p.obs),
        andamentos: Array.isArray(p.andamentos) ? p.andamentos : [],
      });
      okP++;
    } catch {}
  }
  toast(`✅ Importado: ${okC} clientes e ${okP} processos.`);
  renderClients();
}

// Carrega o leitor de Excel (SheetJS) de uma CDN, com alternativas.
async function loadXLSX() {
  const cdns = [
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm",
    "https://esm.sh/xlsx@0.18.5",
    "https://unpkg.com/xlsx@0.18.5/xlsx.mjs",
  ];
  let err;
  for (const u of cdns) { try { return await import(u); } catch (e) { err = e; } }
  throw err || new Error("CDN indisponível");
}

// Importa uma PLANILHA de processos (.xlsx/.xls/.csv), casando com clientes já
// cadastrados — sem criar clientes novos. Separa 1º e 2º grau.
async function importarPlanilha(file) {
  toast("Lendo a planilha… (na 1ª vez, carrega o leitor — precisa de internet)", { duration: 120000 });
  let rows;
  try {
    if (/\.csv$/i.test(file.name)) {
      rows = parseCSV(await file.text());
    } else {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // Detecta o Excel de PRAZOS do tribunal (cabeçalho Processo … Final Prazo)
      // e cria TAREFAS em vez de processos.
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      if (pareceFolhaDePrazos(aoa)) { await importarPrazosFromAOA(aoa); return; }
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }
  } catch (e) {
    toast("Não consegui ler a planilha. " + (e.message || "Verifique a internet e tente de novo."));
    return;
  }
  rows = (rows || []).filter((r) => Object.values(r).some((v) => (v ?? "").toString().trim() !== ""));
  if (!rows.length) { toast("A planilha está vazia ou sem cabeçalho."); return; }

  const [clients, processes] = await Promise.all([list("clients"), list("processes")]);
  if (!clients.length) { toast("Cadastre/importe os clientes primeiro — a planilha vincula aos clientes existentes."); return; }

  const cols = detectColumns(Object.keys(rows[0]));
  // Processa 1º grau antes do 2º, para que o 2º possa casar pelo número do 1º
  const ordenadas = rows.map((r, i) => ({ r, i, g: inferGrau(r, cols) }))
    .sort((a, b) => (a.g === b.g ? a.i - b.i : (a.g < b.g ? -1 : 1))).map((x) => x.r);
  const known = processes.slice();
  const onlyDigits = (s) => (s || "").toString().replace(/\D/g, "");
  // Índice dos processos já cadastrados por (número + grau), para ATUALIZAR no lugar
  // em vez de duplicar — assim reimportar corrige o vínculo errado.
  const idx = new Map();
  for (const p of processes) { const k = onlyDigits(p.num) + "|" + (p.grau || "1"); if (onlyDigits(p.num)) idx.set(k, p); }

  let novos = 0, corrigidos = 0, sem = 0;
  for (const row of ordenadas) {
    try {
      const { client } = matchClient(row, cols, clients, known);
      const base = buildProcessFromRow(row, cols, client);
      const cid = client ? client.id : null;
      const key = onlyDigits(base.num) + "|" + (base.grau || "1");
      const existente = onlyDigits(base.num) ? idx.get(key) : null;
      if (existente) {
        // atualiza vínculo e dados, preservando andamentos e status
        await update("processes", existente.id, { ...base, client_id: cid });
        existente.client_id = cid; // reflete no índice em memória
        corrigidos++;
      } else {
        const saved = await insert("processes", { ...base, client_id: cid, status: "Ativo", andamentos: [] });
        if (saved && onlyDigits(base.num)) idx.set(key, { ...saved, client_id: cid, grau: base.grau });
        novos++;
      }
      if (client && base.num) known.push({ num: base.num, client_id: client.id });
      if (!client) sem++;
    } catch {}
  }
  const partes = [];
  if (novos) partes.push(`${novos} novo(s)`);
  if (corrigidos) partes.push(`${corrigidos} atualizado(s)/corrigido(s)`);
  toast(`✅ ${partes.join(" · ") || "0 processos"}${sem ? " · ⚠️ " + sem + " sem cliente identificado (abra e vincule)" : ""}.`, { duration: 9000 });
  renderClients();
}

// ---------- Importação de PRAZOS (Excel do tribunal → tarefas) ----------
const normHdr = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// É a planilha de prazos do tribunal? (tem cabeçalho "Processo" e "Final Prazo")
function pareceFolhaDePrazos(aoa) {
  for (let i = 0; i < Math.min((aoa || []).length, 10); i++) {
    const cells = (aoa[i] || []).map(normHdr);
    if (cells.includes("processo") && cells.some((c) => c.includes("final prazo"))) return true;
  }
  return false;
}

// Serial do Excel (nº) OU texto "dd/mm/aaaa …" → ISO aaaa-mm-dd (sem fuso).
function excelDataParaISO(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v) && v > 1) {
    const day = Math.floor(v);                       // parte inteira = o dia
    const d = new Date((day - 25569) * 86400000);    // 25569 = 1970-01-01 em serial Excel
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Marcador interno anti-duplicata dos prazos — NÃO deve aparecer para o usuário.
const PRAZO_SIG_RE = /\s*\[eproc-prazo:[^\]]*\]/g;
const descVisivel = (s) => String(s || "").replace(PRAZO_SIG_RE, "").trim();
const sigDe = (s) => { const m = String(s || "").match(/\[eproc-prazo:[^\]]*\]/); return m ? m[0] : ""; };
// "CUMPRIMENTO DE SENTENÇA" -> "Cumprimento de Sentença" (conectivos em minúscula).
function tituloCase(s) {
  s = String(s || "").trim(); if (!s) return "";
  const small = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "no", "na", "à", "às", "para"]);
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && small.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

async function importarPrazosFromAOA(aoa) {
  // Acha a linha de cabeçalho e mapeia as colunas por nome.
  let hi = -1; const H = {};
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const cells = (aoa[i] || []).map(normHdr);
    if (cells.includes("processo") && cells.some((c) => c.includes("final prazo"))) {
      hi = i; cells.forEach((c, idx) => { if (c && !(c in H)) H[c] = idx; }); break;
    }
  }
  if (hi < 0) { toast("Não reconheci o formato do Excel de prazos."); return; }
  const col = (...names) => { for (const n of names) { const k = normHdr(n); if (k in H) return H[k]; } return -1; };
  const ci = {
    num: col("processo"), orgao: col("orgao"), partes: col("partes"), doc: col("doc partes"),
    classe: col("classe"), assunto: col("assunto"), evento: col("evento e prazo"),
    inicio: col("inicio prazo"), final: col("final prazo"),
  };
  const g = (row, idx) => (idx >= 0 && row[idx] != null ? row[idx] : "");
  const limpa = (s) => String(s ?? "").replace(/\r+/g, " ").replace(/\s{2,}/g, " ").trim();

  toast("Cadastrando os prazos…", { duration: 120000 });
  const [tasks, processes, clients] = await Promise.all([list("tasks"), list("processes"), list("clients")]);
  // Índice de clientes por CPF/CNPJ (só dígitos).
  const cpfMap = new Map();
  clients.forEach((c) => { const d = (c.cpf || "").replace(/\D/g, ""); if (d) cpfMap.set(d, c); });

  const jaTemSig = (sig) => tasks.some((t) => (t.description || "").includes(sig));
  const feitasNesteImport = new Set();

  let criadas = 0, repetidas = 0, semProc = 0, semCli = 0;
  for (const row of aoa.slice(hi + 1)) {
    if (!row || !row.length) continue;
    const num = limpa(g(row, ci.num));
    const numKey = cnjKey(num);
    if (!numKey) continue; // linha sem número de processo → ignora

    const dueISO = excelDataParaISO(g(row, ci.final));
    const eventoTxt = limpa(g(row, ci.evento));
    const dias = (eventoTxt.match(/(\d+)\s*dias?/i) || [])[1] || "";
    const classe = limpa(g(row, ci.classe));
    const assunto = limpa(g(row, ci.assunto));
    const orgao = limpa(g(row, ci.orgao));
    const partesTxt = limpa(g(row, ci.partes));
    const inicioISO = excelDataParaISO(g(row, ci.inicio));

    // Assinatura anti-duplicata: processo + vencimento + evento/dias.
    const sig = `[eproc-prazo:${numKey}|${dueISO || "?"}|${normHdr(dias || eventoTxt).slice(0, 30)}]`;
    if (jaTemSig(sig) || feitasNesteImport.has(sig)) { repetidas++; continue; }
    feitasNesteImport.add(sig);

    // Vínculo: processo pelo CNJ; cliente pelo processo, senão por CPF/CNPJ das partes.
    const proc = processes.find((p) => cnjKey(p.num) === numKey) || null;
    let clientId = proc ? (proc.client_id || null) : null;
    if (!clientId) {
      const docs = ((partesTxt + " " + limpa(g(row, ci.doc))).match(/\d{11,14}/g) || []);
      for (const d of docs) { if (cpfMap.has(d)) { clientId = cpfMap.get(d).id; break; } }
    }
    if (!proc) semProc++;
    if (!clientId) semCli++;

    // Título: ⏰ {dias} dias · vence {data final} · {cliente} · {tipo do processo}
    const clienteNome = clientId ? (clients.find((c) => c.id === clientId)?.nome || "") : "";
    const titulo = [
      "⏰ " + (dias ? dias + " dias" : "Prazo"),
      dueISO ? "vence " + prettyDate(dueISO) : null,
      clienteNome || null,
      tituloCase(classe || assunto) || null,
    ].filter(Boolean).join(" · ");
    const desc = [
      `Processo: ${num}`,
      classe ? `Classe: ${classe}` : null,
      assunto ? `Assunto: ${assunto}` : null,
      eventoTxt ? `Evento: ${eventoTxt}` : null,
      orgao ? `Órgão: ${orgao}` : null,
      partesTxt ? `Partes: ${partesTxt}` : null,
      inicioISO ? `Início do prazo: ${prettyDate(inicioISO)}` : null,
      dueISO ? `Prazo final: ${prettyDate(dueISO)}` : null,
      sig,
    ].filter(Boolean).join("\n");

    try {
      await insert("tasks", {
        title: titulo, area: "profissional", priority: "alta",
        due_date: dueISO || null, done: false, description: desc,
        client_id: clientId, process_id: proc ? proc.id : null,
      });
      criadas++;
    } catch { /* ignora a linha que falhou */ }
  }

  const partes = [];
  if (criadas) partes.push(`${criadas} prazo(s) cadastrado(s)`);
  if (repetidas) partes.push(`${repetidas} já existente(s) (ignorado(s))`);
  const alertas = [];
  if (semProc) alertas.push(`${semProc} sem processo cadastrado`);
  if (semCli) alertas.push(`${semCli} sem cliente identificado`);
  toast(`✅ ${partes.join(" · ") || "Nenhum prazo novo"}${alertas.length ? " · ⚠️ " + alertas.join(" · ") : ""}.`, { duration: 10000 });
  if (criadas) navigate("professional"); else refresh();
}

// Importa QUALQUER arquivo (PDF, foto, txt, etc.): extrai o texto e localiza
// números de processo (CNJ), casando com clientes já cadastrados.
async function importarArquivoLivre(file) {
  toast(`Lendo “${file.name}”… (PDF/foto pode levar alguns segundos)`, { duration: 120000 });
  let texto = "";
  try { texto = await extractTextFromFile(file, (m) => toast(m, { duration: 120000 })); }
  catch (e) { toast("Não consegui ler o arquivo. " + (e.message || "")); return; }
  if (!texto || !texto.trim()) { toast("Não encontrei texto nesse arquivo."); return; }

  const [clients, processes] = await Promise.all([list("clients"), list("processes")]);
  const achados = extractProcessesFromText(texto, clients, processes);
  if (!achados.length) { toast("Não encontrei números de processo (padrão CNJ) no arquivo."); return; }

  let ok = 0, sem = 0;
  for (const a of achados) {
    try {
      await insert("processes", {
        num: a.num, nome: (a.client ? a.client.nome + " — " : "") + "Processo " + a.num,
        client_id: a.client ? a.client.id : null, grau: a.grau, status: "Ativo",
        obs: a.contexto || null, andamentos: [],
      });
      ok++; if (!a.client) sem++;
    } catch {}
  }
  toast(`✅ ${ok} processos encontrados${sem ? " · ⚠️ " + sem + " sem cliente identificado (abra e vincule)" : ""}. Revise, pois leitura de PDF/foto pode falhar.`, { duration: 10000 });
  renderClients();
}

// Agrupa itens por proximidade de created_at (cada bloco ≈ uma importação).
function clusterByCreated(items, gapMs = 5 * 60 * 1000) {
  const withT = items.filter((x) => x.created_at)
    .map((x) => ({ x, t: new Date(x.created_at).getTime() }))
    .filter((o) => !isNaN(o.t))
    .sort((a, b) => a.t - b.t);
  const batches = [];
  let cur = null;
  for (const { x, t } of withT) {
    if (cur && t - cur.last <= gapMs) { cur.items.push(x); cur.last = t; }
    else { cur = { items: [x], first: t, last: t }; batches.push(cur); }
  }
  return batches.reverse(); // mais recentes primeiro
}

// Ferramenta: ver e excluir importações/criações recentes de processos.
async function openImportsManager() {
  const procs = await list("processes");
  const batches = clusterByCreated(procs);
  const fmt = (ms) => { const d = new Date(ms); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

  const rows = batches.map((bt, i) => el("div", { class: "row" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, `${bt.items.length} processo${bt.items.length > 1 ? "s" : ""}` + (i === 0 ? "  · mais recente" : "")),
      el("div", { class: "t2" }, "criados em " + fmt(bt.first)),
    ]),
    el("button", { class: "btn btn-danger btn-sm", onclick: async () => {
      if (!confirm(`Excluir ${bt.items.length} processo(s) criados em ${fmt(bt.first)}?\n\nOs CLIENTES não são afetados. Isso não pode ser desfeito.`)) return;
      for (const it of bt.items) { try { await remove("processes", it.id); } catch {} }
      closeModal(); toast(`🗑 ${bt.items.length} processo(s) excluído(s).`); openImportsManager();
    } }, "🗑 Excluir"),
  ]));

  openModal(el("div", {}, [
    el("h3", {}, "Desfazer importações"),
    el("p", { class: "t2", style: "margin-bottom:12px" }, "Cada bloco reúne os processos criados juntos (geralmente uma importação de Excel). Exclua os que quiser — os clientes não são afetados. Os mais recentes ficam no topo."),
    rows.length ? el("div", { class: "list" }, rows) : el("div", { class: "empty" }, "Nenhum processo cadastrado."),
    el("div", { class: "modal-actions" }, [el("button", { class: "btn btn-ghost", onclick: closeModal }, "Fechar")]),
  ]));
}

function clientCard(c) {
  return el("div", { class: "row", onclick: () => openClient(c.id) }, [
    avatar(c.nome),
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, c.nome),
      el("div", { class: "t2" }, [c.cpf || "CPF não informado", c.tel || ""].filter(Boolean).join(" · ")),
    ]),
    el("span", { class: "pill" }, "abrir ›"),
  ]);
}

function grauSection(label, arr, grauVal, clientId) {
  return el("div", { class: "card" }, [
    el("div", { class: "section-head", style: "margin-bottom:10px" }, [
      el("div", { class: "card-title", style: "margin:0" }, `${label} (${arr.length})`),
      el("button", { class: "btn btn-primary btn-sm", onclick: () => openProcessModal(null, clientId, () => openClient(clientId), grauVal) }, "＋ Novo"),
    ]),
    arr.length
      ? el("div", { class: "list" }, arr.map((p) => processCard(p, true, null, () => openProcess(p.id, () => openClient(clientId)))))
      : el("div", { class: "empty" }, "Nenhum processo neste grau."),
  ]);
}

async function openClient(id) {
  loading();
  const [clients, procs, tasks] = await Promise.all([list("clients"), list("processes"), list("tasks")]);
  const c = clients.find((x) => x.id === id);
  if (!c) { renderClients(); return; }
  // Processos onde este cliente é o principal OU um dos vinculados (client_ids).
  const meus = procs.filter((p) => p.client_id === id || (Array.isArray(p.client_ids) && p.client_ids.includes(id)));
  // Só tarefas profissionais aparecem na pasta do cliente.
  // As pessoais vinculadas a um cliente são referência privada (ficam só no cadastro pessoal).
  const minhasTarefas = tasks.filter((t) => t.client_id === id && t.area === "profissional" && !t.done);

  const dados = [
    ["CPF", c.cpf], ["RG", c.rg], ["Telefone", c.tel], ["E-mail", c.email],
    ["Nascimento", c.nasc ? prettyDate(c.nasc) : ""], ["Endereço", c.endereco],
    ["Nacionalidade", c.nacionalidade], ["Estado civil", c.estado_civil], ["Profissão", c.profissao],
    ["Área", c.area], ["Origem", c.origem],
  ].filter(([, v]) => v);

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("button", { class: "back-btn", onclick: renderClients }, "← Clientes"),
    el("div", { class: "detail-head" }, [
      avatar(c.nome),
      el("div", {}, [el("h1", { class: "page-title", style: "font-size:20px" }, c.nome), el("p", { class: "page-sub" }, "Pasta do cliente")]),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, "Dados cadastrais"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openClientModal(c) }, "Editar"),
      ]),
      dados.length
        ? el("dl", { class: "kv" }, dados.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))
        : el("div", { class: "empty" }, "Sem dados extras. Toque em Editar."),
      c.obs ? el("div", { class: "t2", style: "margin-top:10px; white-space:pre-wrap" }, "📝 " + c.obs) : null,
    ]),
    grauSection("Processos — 1º grau", meus.filter((p) => (p.grau || "1") !== "2"), "1", id),
    grauSection("Processos — 2º grau", meus.filter((p) => p.grau === "2"), "2", id),
    attachmentsCard("clients", c),
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, `Tarefas do cliente (${minhasTarefas.length})`),
      minhasTarefas.length
        ? el("div", { class: "list" }, minhasTarefas.map((t) => taskRow(t, false, () => openClient(id))))
        : el("div", { class: "empty" }, "Nenhuma tarefa vinculada. Use a Captura rápida no Início."),
    ]),
    el("div", { style: "text-align:center;margin-top:6px" }, [
      el("button", { class: "btn btn-danger btn-sm", onclick: async () => {
        if (confirm(`Excluir o cliente "${c.nome}"? Os processos ficam sem vínculo.`)) { await remove("clients", id); renderClients(); }
      } }, "Excluir cliente"),
    ]),
  );
  removeFab();
}

function openClientModal(existing) {
  const f = existing || {};
  const inp = (ph, val, attrs = {}) => el("input", { class: "form-control", placeholder: ph, value: val || "", ...attrs });
  const nome = inp("Nome completo *", f.nome, { required: "" });
  const cpf = inp("000.000.000-00", f.cpf);
  const rg = inp("RG", f.rg);
  const tel = inp("(51) 9 0000-0000", f.tel);
  const email = inp("email@exemplo.com", f.email, { type: "email" });
  const nasc = inp("", f.nasc, { type: "date" });
  const endereco = inp("Rua, nº, bairro, cidade — UF", f.endereco);
  const area = inp("Ex: Família, Cível…", f.area);
  const origem = inp("Ex: Indicação, Instagram…", f.origem);
  const obs = el("textarea", { rows: "3", placeholder: "Resumo do caso, histórico…" }, f.obs || "");
  // Qualificação (usada para gerar procuração/declaração)
  const nacionalidade = inp("brasileira / brasileiro", f.nacionalidade);
  const estadoCivil = inp("Ex: casada, solteiro…", f.estado_civil);
  const profissao = inp("Ex: professora, empresário…", f.profissao);

  const form = el("form", {}, [
    lbl("Nome *", nome), lbl("CPF", cpf), lbl("RG", rg), lbl("Telefone / WhatsApp", tel),
    lbl("E-mail", email), lbl("Nascimento", nasc), lbl("Endereço", endereco),
    el("div", { class: "cap-row" }, [lbl("Nacionalidade", nacionalidade), lbl("Estado civil", estadoCivil), lbl("Profissão", profissao)]),
    lbl("Área", area), lbl("Origem", origem), lbl("Observações", obs),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) { nome.focus(); return; }
    const data = { nome: nome.value.trim(), cpf: cpf.value.trim(), rg: rg.value.trim(), tel: tel.value.trim(), email: email.value.trim(), nasc: nasc.value || null, endereco: endereco.value.trim(), area: area.value.trim(), origem: origem.value.trim(), obs: obs.value.trim(), nacionalidade: nacionalidade.value.trim(), estado_civil: estadoCivil.value.trim(), profissao: profissao.value.trim() };
    if (existing) { await update("clients", existing.id, data); closeModal(); openClient(existing.id); }
    else { const saved = await insert("clients", data); closeModal(); if (saved) openClient(saved.id); else renderClients(); }
  };
  openModal(el("div", {}, [el("h3", {}, existing ? "Editar cliente" : "Novo cliente"), form]));
  setTimeout(() => nome.focus(), 50);
}

// ==================== PESSOAS / CONTATOS ====================
const MES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const RELACOES = ["Amigo(a)", "Familiar", "Cliente", "Colega", "Contato", "Outro"];

// Ícone de traço (referencia o sprite do index.html).
function svgUse(id, cls = "ico-line") {
  const s = el("span", { class: cls });
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  return s;
}

// Extrai dia/mês/ano de uma data de nascimento (aaaa-mm-dd).
function parseBday(nasc) {
  const m = String(nasc || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: +m[1], month, day };
}
// Situação do aniversário em relação a HOJE: se é hoje, quantos dias faltam,
// quantos anos completa. (Comparação por dia local, ignorando horas.)
function bdayStatus(nasc, ref = new Date()) {
  const b = parseBday(nasc); if (!b) return null;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let next = new Date(today.getFullYear(), b.month - 1, b.day);
  if (next < today) next = new Date(today.getFullYear() + 1, b.month - 1, b.day);
  const daysUntil = Math.round((next - today) / 86400000);
  const isToday = (b.month - 1 === today.getMonth()) && (b.day === today.getDate());
  const hasYear = b.year > 1900;
  const turning = hasYear ? next.getFullYear() - b.year : null;
  return { ...b, next, daysUntil, isToday, turning, hasYear };
}
function bdayBadge(b) {
  return el("div", { class: "bday-badge" + (b.isToday ? " today" : "") }, [
    el("span", { class: "d" }, String(b.day).padStart(2, "0")),
    el("span", { class: "m" }, MES_ABREV[b.month - 1]),
  ]);
}

// Seção "Pessoas" que aparece na aba Pessoal: dois botões + aviso de aniversários.
function contactsHub(contacts) {
  const withB = contacts.map((c) => ({ c, b: bdayStatus(c.nasc) })).filter((x) => x.b);
  const hoje = withB.filter((x) => x.b.isToday);
  const semana = withB.filter((x) => !x.b.isToday && x.b.daysUntil <= 7).sort((a, z) => a.b.daysUntil - z.b.daysUntil);

  const hub = (icoId, titulo, sub, route) =>
    el("button", { class: "hub-btn", onclick: () => navigate(route) }, [
      el("span", { class: "hub-ico" }, svgUse(icoId)),
      el("span", { class: "hub-t" }, titulo),
      el("span", { class: "hub-s" }, sub),
    ]);

  const kids = [
    el("div", { class: "card-title" }, "Pessoas"),
    el("div", { class: "hub-grid" }, [
      hub("i-users", "Contatos", `${contacts.length} pessoa${contacts.length === 1 ? "" : "s"}`, "contacts"),
      hub("i-cake", "Aniversários", hoje.length ? `${hoje.length} hoje` : (semana.length ? `${semana.length} esta semana` : "ver por mês"), "birthdays"),
    ]),
  ];
  if (hoje.length) {
    kids.push(el("div", { class: "bday-teaser today", onclick: () => navigate("birthdays") }, [
      svgUse("i-cake"), el("span", {}, "Aniversário hoje: " + hoje.map((x) => x.c.nome).join(", ")),
    ]));
  } else if (semana.length) {
    kids.push(el("div", { class: "bday-teaser", onclick: () => navigate("birthdays") }, [
      svgUse("i-cake"), el("span", {}, "Esta semana: " + semana.slice(0, 3).map((x) => `${x.c.nome} (${String(x.b.day).padStart(2, "0")}/${String(x.b.month).padStart(2, "0")})`).join(", ")),
    ]));
  }
  return el("div", { class: "card" }, kids);
}

// Cabeçalho de página com botão de voltar.
function pageHeaderBack(title, sub, backRoute) {
  return el("div", {}, [
    el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:8px", onclick: () => navigate(backRoute) }, "‹ Voltar"),
    el("h1", { class: "page-title" }, title),
    sub ? el("p", { class: "page-sub" }, sub) : null,
  ]);
}

// ---------- Lista de contatos (cartões) ----------
async function renderContacts() {
  loading();
  const [contacts, clients] = await Promise.all([
    list("contacts", { orderBy: "nome", asc: true }),
    list("clients", { orderBy: "nome", asc: true }).catch(() => []),
  ]);
  // Quantos clientes ainda NÃO estão nos contatos (para oferecer a importação).
  const norm = (s) => (s || "").trim().toLowerCase();
  const jaContato = new Set(contacts.map((c) => norm(c.nome)));
  const clientesFaltando = clients.filter((c) => c.nome && !jaContato.has(norm(c.nome)));

  const main = $("#main");
  main.innerHTML = "";
  const search = el("input", { class: "search-box", type: "search", placeholder: "🔎 Buscar por nome, telefone…" });
  const listWrap = el("div", { class: "list" });
  const draw = (q = "") => {
    const f = q.trim().toLowerCase();
    const rows = contacts.filter((c) => !f || [c.nome, c.tel, c.email, c.relacao].some((x) => (x || "").toLowerCase().includes(f)));
    listWrap.innerHTML = "";
    if (!rows.length) { listWrap.append(el("div", { class: "empty" }, contacts.length ? "Nenhum contato encontrado." : "Nenhuma pessoa cadastrada. Toque em + para adicionar.")); return; }
    rows.forEach((c) => listWrap.append(contactCard(c)));
  };
  search.addEventListener("input", () => draw(search.value));

  // Cabeçalho com botão de "Importar clientes" (traz os clientes que ainda não
  // estão nos contatos). Só aparece quando há clientes faltando.
  const header = el("div", {}, [
    el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:8px", onclick: () => navigate("personal") }, "‹ Voltar"),
    el("div", { class: "section-head", style: "align-items:center; gap:8px" }, [
      el("div", {}, [el("h1", { class: "page-title" }, "Contatos"), el("p", { class: "page-sub" }, `${contacts.length} pessoa${contacts.length === 1 ? "" : "s"}`)]),
      clientesFaltando.length
        ? el("button", { class: "btn btn-ghost btn-sm", style: "flex-shrink:0", onclick: () => importClientsToContacts(clientesFaltando), title: "Trazer seus clientes para os contatos" }, `⬇ Clientes (${clientesFaltando.length})`)
        : null,
    ]),
  ]);

  main.append(header, search, listWrap);
  // Sem nenhum contato ainda, mas com clientes: oferece a importação em destaque.
  if (!contacts.length && clientesFaltando.length) {
    main.append(el("button", { class: "btn btn-primary btn-block", onclick: () => importClientsToContacts(clientesFaltando) }, `Importar meus ${clientesFaltando.length} clientes para os contatos`));
  }
  draw();
  addFab(() => openContactModal());
}

// Traz os clientes (do CRM) para a pasta de Contatos, sem duplicar quem já existe.
async function importClientsToContacts(clientesFaltando) {
  let faltando = clientesFaltando;
  if (!faltando) {
    const [clients, contacts] = await Promise.all([list("clients", { orderBy: "nome", asc: true }).catch(() => []), list("contacts")]);
    const jaContato = new Set(contacts.map((c) => (c.nome || "").trim().toLowerCase()));
    faltando = clients.filter((c) => c.nome && !jaContato.has((c.nome || "").trim().toLowerCase()));
  }
  if (!faltando.length) { toast("Todos os seus clientes já estão nos contatos."); return; }
  toast(`Importando ${faltando.length} cliente${faltando.length === 1 ? "" : "s"}…`, { duration: 60000 });
  let ok = 0;
  for (const c of faltando) {
    try {
      await insert("contacts", {
        nome: c.nome, relacao: "Cliente", tel: c.tel || "", email: c.email || "",
        nasc: c.nasc || null, endereco: c.endereco || "", obs: "",
      });
      ok++;
    } catch {}
  }
  toast(`✅ ${ok} cliente${ok === 1 ? "" : "s"} adicionado${ok === 1 ? "" : "s"} aos contatos.`);
  renderContacts();
}

function contactCard(c) {
  const b = bdayStatus(c.nasc);
  const sub = [c.relacao, c.tel].filter(Boolean).join(" · ");
  let right;
  if (b) right = el("span", { class: "pill" + (b.isToday ? " today-pill" : "") }, b.isToday ? "faz hoje" : `${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}`);
  else right = el("span", { class: "pill" }, "abrir ›");
  return el("div", { class: "row", onclick: () => openContact(c.id) }, [
    avatar(c.nome),
    el("div", { class: "grow" }, [el("div", { class: "t1" }, c.nome), sub ? el("div", { class: "t2" }, sub) : null]),
    right,
  ]);
}

// Cartão de contato aberto (detalhes + ações: WhatsApp, ligar, e-mail).
async function openContact(id) {
  const contacts = await list("contacts");
  const c = contacts.find((x) => x.id === id);
  if (!c) { renderContacts(); return; }
  const b = bdayStatus(c.nasc);
  const kv = (label, val) => val ? el("div", { class: "ckv" }, [el("span", { class: "ckv-k" }, label), el("span", { class: "ckv-v" }, val)]) : null;
  const digits = (c.tel || "").replace(/\D/g, "");
  const dataNasc = b ? `${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}${b.hasYear ? "/" + b.year : ""}` : null;
  const idadeTxt = (b && b.turning != null) ? `${b.isToday ? "faz" : "fará"} ${b.turning} anos${b.isToday ? " hoje 🎉" : ""}` : "";

  const acoes = [
    digits ? el("a", { class: "btn btn-sm", href: `https://wa.me/55${digits}`, target: "_blank", rel: "noopener" }, "WhatsApp") : null,
    c.tel ? el("a", { class: "btn btn-sm", href: `tel:${(c.tel || "").replace(/\s/g, "")}` }, "Ligar") : null,
    c.email ? el("a", { class: "btn btn-sm", href: `mailto:${c.email}` }, "E-mail") : null,
  ].filter(Boolean);

  const body = el("div", {}, [
    el("div", { class: "contact-head" }, [
      avatar(c.nome),
      el("div", {}, [el("div", { class: "t1", style: "font-weight:700; font-size:17px" }, c.nome), c.relacao ? el("div", { class: "t2" }, c.relacao) : null]),
    ]),
    dataNasc ? kv("Aniversário", [dataNasc, idadeTxt].filter(Boolean).join(" · ")) : null,
    kv("Telefone", c.tel),
    kv("E-mail", c.email),
    kv("Endereço", c.endereco),
    c.obs ? el("div", { class: "t2", style: "margin-top:10px; white-space:pre-wrap" }, c.obs) : null,
    acoes.length ? el("div", { class: "modal-actions", style: "flex-wrap:wrap" }, acoes) : null,
    el("div", { class: "modal-actions" }, [
      el("button", { class: "btn btn-danger", onclick: async () => { if (confirm("Excluir este contato?")) { await remove("contacts", c.id); closeModal(); renderContacts(); } } }, "Excluir"),
      el("button", { class: "btn btn-primary", onclick: () => openContactModal(c) }, "Editar"),
    ]),
  ]);
  openModal(el("div", {}, [el("h3", {}, "Contato"), body]));
}

function openContactModal(existing) {
  const f = existing || {};
  const inp = (ph, val, attrs = {}) => el("input", { class: "form-control", placeholder: ph, value: val || "", ...attrs });
  const nome = inp("Nome *", f.nome, { required: "" });
  const rel = el("select", { class: "form-control" }, [
    el("option", { value: "" }, "Relação (opcional)"),
    ...RELACOES.map((r) => el("option", { value: r, ...(f.relacao === r ? { selected: "" } : {}) }, r)),
    ...(f.relacao && !RELACOES.includes(f.relacao) ? [el("option", { value: f.relacao, selected: "" }, f.relacao)] : []),
  ]);
  const tel = inp("(51) 9 0000-0000", f.tel);
  const email = inp("email@exemplo.com", f.email, { type: "email" });
  const nasc = inp("", f.nasc, { type: "date" });
  const endereco = inp("Cidade, bairro…", f.endereco);
  const obs = el("textarea", { rows: "3", placeholder: "Como conheceu, preferências, observações…" }, f.obs || "");

  const form = el("form", {}, [
    lbl("Nome *", nome), lbl("Relação", rel), lbl("Telefone / WhatsApp", tel), lbl("E-mail", email),
    lbl("Aniversário", nasc), lbl("Endereço / cidade", endereco), lbl("Observações", obs),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) { nome.focus(); return; }
    const data = { nome: nome.value.trim(), relacao: rel.value, tel: tel.value.trim(), email: email.value.trim(), nasc: nasc.value || null, endereco: endereco.value.trim(), obs: obs.value.trim() };
    if (existing) { await update("contacts", existing.id, data); closeModal(); openContact(existing.id); }
    else { const saved = await insert("contacts", data); closeModal(); if (saved) openContact(saved.id); else renderContacts(); }
  };
  openModal(el("div", {}, [el("h3", {}, existing ? "Editar contato" : "Nova pessoa"), form]));
  setTimeout(() => nome.focus(), 50);
}

// ---------- Lista de aniversários (hoje / próximos 7 dias / por mês) ----------
async function renderBirthdays() {
  loading();
  const contacts = await list("contacts", { orderBy: "nome", asc: true });
  const withB = contacts.map((c) => ({ c, b: bdayStatus(c.nasc) })).filter((x) => x.b);
  const byName = (a, z) => (a.c.nome || "").localeCompare(z.c.nome || "");
  const hoje = withB.filter((x) => x.b.isToday).sort(byName);
  const semana = withB.filter((x) => !x.b.isToday && x.b.daysUntil <= 7).sort((a, z) => a.b.daysUntil - z.b.daysUntil);

  const secao = (titulo, arr, vazio) => el("div", { class: "card" }, [
    el("div", { class: "card-title" }, titulo),
    arr.length ? el("div", { class: "list" }, arr.map(bdayRow)) : el("div", { class: "empty" }, vazio),
  ]);

  let selMonth = new Date().getMonth();
  const monthCard = el("div", { class: "card" });
  const drawMonth = () => {
    const rows = withB.filter((x) => x.b.month - 1 === selMonth).sort((a, z) => a.b.day - z.b.day);
    monthCard.innerHTML = "";
    monthCard.append(
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => { selMonth = (selMonth + 11) % 12; drawMonth(); } }, "‹"),
        el("div", { class: "card-title", style: "margin:0; text-transform:capitalize" }, MESES[selMonth]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => { selMonth = (selMonth + 1) % 12; drawMonth(); } }, "›"),
      ]),
      rows.length ? el("div", { class: "list" }, rows.map(bdayRow)) : el("div", { class: "empty" }, "Ninguém faz aniversário neste mês."),
    );
  };
  drawMonth();

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    pageHeaderBack("Aniversários", withB.length ? `${withB.length} com data cadastrada` : null, "personal"),
    secao("Hoje", hoje, "Ninguém faz aniversário hoje."),
    secao("Próximos 7 dias", semana, "Nada nos próximos 7 dias."),
    monthCard,
  );
  if (!withB.length) main.append(el("div", { class: "empty" }, "Cadastre as datas de nascimento em Contatos para ver os aniversários aqui."));
}

function bdayRow(x) {
  const { c, b } = x;
  const idade = (b.turning != null) ? `${b.isToday ? "faz" : "fará"} ${b.turning}` : null;
  const meta = [c.relacao, idade].filter(Boolean).join(" · ");
  const when = b.isToday
    ? el("span", { class: "pill today-pill" }, "hoje")
    : el("span", { class: "pill" }, b.daysUntil === 1 ? "amanhã" : `em ${b.daysUntil}d`);
  return el("div", { class: "row bday-row", onclick: () => openContact(c.id) }, [
    bdayBadge(b),
    el("div", { class: "grow" }, [el("div", { class: "t1" }, c.nome), meta ? el("div", { class: "t2" }, meta) : null]),
    when,
  ]);
}

// ==================== PROCESSOS ====================
async function renderProcesses() {
  loading();
  const [procs, clients] = await Promise.all([list("processes"), list("clients")]);
  const nameOf = (cid) => clients.find((c) => c.id === cid)?.nome || "";
  const main = $("#main");
  main.innerHTML = "";
  const search = el("input", { class: "search-box", type: "search", placeholder: "🔎 Buscar por nº, nome ou cliente…" });
  const chips = el("div", { class: "filters" }, ["Todos", ...STATUS].map((s) =>
    el("button", { class: "chip" + (s === "Todos" ? " active" : ""), "data-s": s, onclick: (e) => { $$(".chip", chips).forEach((x) => x.classList.remove("active")); e.target.classList.add("active"); draw(); } }, s)
  ));
  const listWrap = el("div", { class: "list" });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const sf = $(".chip.active", chips)?.dataset.s || "Todos";
    const rows = procs.filter((p) => {
      if (sf !== "Todos" && (p.status || "Ativo") !== sf) return false;
      if (!q) return true;
      return [p.num, p.nome, nameOf(p.client_id)].some((x) => (x || "").toLowerCase().includes(q));
    });
    listWrap.innerHTML = "";
    if (!rows.length) { listWrap.append(el("div", { class: "empty" }, procs.length ? "Nenhum processo encontrado." : "Nenhum processo ainda. Toque em + para cadastrar.")); return; }
    rows.forEach((p) => listWrap.append(processCard(p, false, nameOf(p.client_id))));
  };
  search.addEventListener("input", draw);
  // Importar prazos do tribunal (Excel .xls/.xlsx) → cria as tarefas de prazo,
  // vinculando ao processo (CNJ) e ao cliente (CPF/CNPJ das partes).
  const prazoInput = el("input", { type: "file", class: "hidden", accept: ".xls,.xlsx,.csv" });
  prazoInput.addEventListener("change", async () => {
    const f = prazoInput.files[0]; prazoInput.value = "";
    if (f) await importarPlanilha(f);
  });
  main.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [el("h1", { class: "page-title" }, "Processos"), el("p", { class: "page-sub" }, `${procs.length} cadastrado${procs.length === 1 ? "" : "s"}`)]),
      el("button", { class: "btn btn-ghost btn-sm", style: "flex-shrink:0", onclick: () => prazoInput.click(), title: "Importar Excel de prazos do tribunal" }, "⬆ Importar prazos"),
    ]),
    prazoInput, search, chips, listWrap,
  );
  draw();
  addFab(() => openProcessModal());
}

function statusBadge(s) {
  const k = (s || "Ativo").toLowerCase();
  return el("span", { class: "badge badge-" + (k === "encerrado" ? "encerrado" : k === "suspenso" ? "suspenso" : "ativo") }, s || "Ativo");
}

function processCard(p, compact, clienteNome, onOpen) {
  const meta = [];
  meta.push(el("span", { class: "tag" }, p.grau === "2" ? "🏛️ 2º grau" : "⚖️ 1º grau"));
  if (p.tipo) meta.push(el("span", { class: "tag" }, p.tipo));
  if (p.fase) meta.push(el("span", { class: "tag" }, "📍 " + p.fase));
  if (!compact && clienteNome) meta.push(el("span", { class: "tag" }, "👤 " + clienteNome));
  if (p.andamentos && p.andamentos.length) meta.push(el("span", { class: "tag" }, "🕓 " + p.andamentos.length));
  return el("div", { class: "row", style: "align-items:flex-start", onclick: onOpen || (() => openProcess(p.id, renderProcesses)) }, [
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, p.nome),
      p.num ? el("div", { class: "t2" }, "Nº " + p.num) : null,
      el("div", { class: "proc-meta" }, meta),
    ]),
    statusBadge(p.status),
  ]);
}

// Página de visualização (só leitura) do processo, com botão Editar
async function openProcess(id, backFn) {
  loading();
  const back = backFn || renderProcesses;
  const [procs, clients] = await Promise.all([list("processes"), list("clients")]);
  const p = procs.find((x) => x.id === id);
  if (!p) { back(); return; }
  const cliente = clients.find((c) => c.id === p.client_id);
  // Todos os clientes vinculados (principal + client_ids), sem repetir.
  const vinculadosIds = [...new Set([p.client_id, ...(Array.isArray(p.client_ids) ? p.client_ids : [])].filter(Boolean))];
  const clientesVinc = vinculadosIds.map((cid) => clients.find((c) => c.id === cid)).filter(Boolean);
  const clientesLabel = clientesVinc.length ? clientesVinc.map((c) => c.nome).join(", ") : (cliente ? cliente.nome : "");

  const linhas = [
    ["Número", p.num], [clientesVinc.length > 1 ? "Clientes" : "Cliente", clientesLabel], ["Grau", p.grau === "2" ? "2º grau" : "1º grau"],
    ["Tipo de ação", p.tipo],
    ["Vara / Juízo", p.vara], ["Tribunal", p.tribunal], ["Partes contrárias", p.partes],
    ["Distribuição", p.data_distribuicao ? prettyDate(p.data_distribuicao) : ""],
    ["Fase atual", p.fase], ["Valor da causa", p.valor != null ? BRLnum(p.valor) : ""],
  ].map(([k, v]) => [k, asText(v)]).filter(([, v]) => v);

  const ands = Array.isArray(p.andamentos) ? p.andamentos : [];
  const timeline = el("div", { class: "timeline" });
  ands.slice().reverse().forEach((a) => timeline.append(el("div", { class: "and-item" }, [
    el("div", { class: "and-dot" }),
    el("div", { class: "and-body" }, [
      el("div", { class: "and-when" }, (a.data ? prettyDate(a.data) : "") + (a.hora ? " às " + a.hora : "")),
      el("div", { class: "and-text" }, a.texto || ""),
    ]),
  ])));
  if (!ands.length) timeline.append(el("div", { class: "t2" }, "Nenhum andamento registrado."));

  // adicionar andamento rápido (sem entrar em edição)
  const andInput = el("input", { class: "form-control", placeholder: "Novo andamento…" });
  const addAnd = async () => {
    const txt = andInput.value.trim(); if (!txt) return;
    const now = new Date(); const off = now.getTimezoneOffset();
    const novo = { data: new Date(now.getTime() - off * 60000).toISOString().slice(0, 10), hora: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), texto: txt };
    await update("processes", id, { andamentos: [...ands, novo] });
    openProcess(id, backFn);
  };
  andInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAnd(); } });

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("button", { class: "back-btn", onclick: back }, "← Voltar"),
    el("div", { class: "section-head", style: "align-items:flex-start" }, [
      el("div", {}, [el("h1", { class: "page-title", style: "font-size:19px" }, p.nome), cliente ? el("p", { class: "page-sub" }, "👤 " + cliente.nome) : null]),
      statusBadge(p.status),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, "Dados do processo"),
        el("button", { class: "btn btn-primary btn-sm", onclick: () => openProcessModal(p, null, () => openProcess(id, backFn)) }, "✏️ Editar"),
      ]),
      linhas.length
        ? el("dl", { class: "kv" }, linhas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))
        : el("div", { class: "empty" }, "Sem dados preenchidos. Toque em Editar."),
      p.obs ? el("div", { class: "t2", style: "margin-top:10px; white-space:pre-wrap" }, "📝 " + p.obs) : null,
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, `Andamentos (${ands.length})`),
      timeline,
      el("div", { class: "and-add" }, [andInput, el("button", { class: "btn btn-sm", onclick: addAnd }, "Adicionar")]),
    ]),
    attachmentsCard("processes", p),
    clientesVinc.length ? el("div", { style: "text-align:center;margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center" },
      clientesVinc.map((c) => el("button", { class: "btn btn-ghost btn-sm", onclick: () => openClient(c.id) }, "Abrir pasta de " + c.nome.split(/\s+/)[0] + " →"))
    ) : null,
  );
  removeFab();
}

function openProcessModal(existing, fixedClientId, onDone, defaultGrau) {
  const f = existing || {};
  // Limpa campos que possam ter sido salvos como objeto ("[object Object]").
  ["nome", "tipo", "vara", "tribunal", "partes", "fase", "obs"].forEach((k) => { if (f[k] != null) f[k] = asText(f[k]); });
  const inp = (ph, val, attrs = {}) => el("input", { class: "form-control", placeholder: ph, value: val ?? "", ...attrs });
  const sel = (opts, val) => { const s = el("select", { class: "form-control" }); opts.forEach((o) => s.append(el("option", { value: o, ...(o === val ? { selected: "" } : {}) }, o))); return s; };

  const num = inp("0000000-00.0000.8.21.0000", f.num);
  const nome = inp("Ex: Revisão de Alimentos — João Silva", f.nome, { required: "" });
  const clienteSel = el("select", { class: "form-control" });
  clienteSel.append(el("option", { value: "" }, "— nenhum —"));
  const tipo = sel(TIPOS, f.tipo);
  const vara = inp("Ex: 1ª Vara de Família — Venâncio Aires", f.vara);
  const tribunal = sel(TRIBUNAIS, f.tribunal);
  const partes = inp("Parte contrária, advogado…", f.partes);
  const data = inp("", f.data_distribuicao, { type: "date" });
  const fase = sel(FASES, f.fase);
  const status = sel(STATUS, f.status || "Ativo");
  const grauSel = el("select", { class: "form-control" });
  [["1", "1º grau"], ["2", "2º grau"]].forEach(([v, l]) => grauSel.append(el("option", { value: v, ...(((f.grau || defaultGrau || "1") === v) ? { selected: "" } : {}) }, l)));
  const valor = inp("Ex: 15000 ou 15.000,00", f.valor != null ? String(f.valor) : "", { inputmode: "decimal" });
  const obs = el("textarea", { rows: "3", placeholder: "Histórico, estratégia, pontos de atenção…" }, f.obs || "");

  // andamentos: existentes + novos
  let ands = Array.isArray(f.andamentos) ? f.andamentos.slice() : [];
  const timeline = el("div", { class: "timeline" });
  const andText = el("input", { class: "form-control", placeholder: "Descreva o andamento…" });
  const drawAnds = () => {
    timeline.innerHTML = "";
    if (!ands.length) { timeline.append(el("div", { class: "t2" }, "Nenhum andamento registrado.")); return; }
    ands.slice().reverse().forEach((a, revIdx) => {
      const i = ands.length - 1 - revIdx;
      timeline.append(el("div", { class: "and-item" }, [
        el("div", { class: "and-dot" }),
        el("div", { class: "and-body" }, [
          el("div", { class: "and-when" }, prettyDate(a.data) + (a.hora ? " às " + a.hora : "")),
          el("div", { class: "and-text" }, a.texto),
        ]),
        el("button", { class: "del", type: "button", onclick: () => { ands.splice(i, 1); drawAnds(); } }, "×"),
      ]));
    });
  };
  const addAnd = () => {
    const t = andText.value.trim(); if (!t) return;
    const now = new Date();
    const off = now.getTimezoneOffset();
    const dataISO = new Date(now.getTime() - off * 60000).toISOString().slice(0, 10);
    ands.push({ data: dataISO, hora: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), texto: t });
    andText.value = ""; drawAnds();
  };
  andText.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAnd(); } });
  drawAnds();

  const form = el("form", {}, [
    lbl("Número do processo", num), lbl("Nome / Descrição *", nome), lbl("Cliente", clienteSel),
    lbl("Grau", grauSel), lbl("Tipo de ação", tipo), lbl("Vara / Juízo", vara), lbl("Tribunal", tribunal),
    lbl("Partes contrárias", partes), lbl("Data de distribuição", data), lbl("Fase atual", fase),
    lbl("Status", status), lbl("Valor da causa (R$)", valor), lbl("Observações / Estratégia", obs),
    el("div", { class: "card", style: "background:var(--bg-elev)" }, [
      el("div", { class: "card-title" }, "Andamentos"),
      timeline,
      el("div", { class: "and-add" }, [andText, el("button", { type: "button", class: "btn btn-sm", onclick: addAnd }, "Adicionar")]),
    ]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) { nome.focus(); return; }
    const payload = {
      num: num.value.trim(), nome: nome.value.trim(), client_id: clienteSel.value || null,
      tipo: tipo.value, vara: vara.value.trim(), tribunal: tribunal.value, partes: partes.value.trim(),
      data_distribuicao: data.value || null, fase: fase.value, status: status.value, grau: grauSel.value,
      valor: parseValor(valor.value), obs: obs.value.trim(), andamentos: ands,
    };
    if (existing) await update("processes", existing.id, payload);
    else await insert("processes", payload);
    closeModal();
    if (onDone) onDone();
    else if (fixedClientId) openClient(fixedClientId);
    else renderProcesses();
  };

  openModal(el("div", {}, [
    el("h3", {}, existing ? "Editar processo" : "Novo processo"),
    existing ? el("button", { class: "btn btn-danger btn-sm", style: "float:right;margin-top:-40px", onclick: async () => { if (confirm("Excluir este processo?")) { await remove("processes", existing.id); closeModal(); fixedClientId ? openClient(fixedClientId) : renderProcesses(); } } }, "Excluir") : null,
    form,
  ]));
  // popular o select de clientes e pré-selecionar
  list("clients", { orderBy: "nome", asc: true }).then((cs) => {
    cs.forEach((c) => clienteSel.append(el("option", { value: c.id, ...(((fixedClientId || f.client_id) === c.id) ? { selected: "" } : {}) }, c.nome)));
  });
  setTimeout(() => nome.focus(), 50);
}

function lbl(text, control) { return el("label", {}, [text, control]); }
function BRLnum(n) { return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function parseValor(s) {
  if (s == null) return null;
  let v = String(s).replace(/[^\d.,-]/g, "");
  if (!v) return null;
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(",", ".");
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ==================== PUBLICAÇÕES OFICIAIS ====================
// Busca no Gmail os e-mails de "Movimentações Processuais - EPROC" e monta uma
// tabela com o teor de cada publicação (processo, órgão, evento, prazo, data…).
// Usa o Gmail em modo leitura (gmail.js), no próprio navegador. Cada publicação
// é vinculada, na hora, ao processo e ao(s) cliente(s) já cadastrados — casando
// pelo número do processo (CNJ).
let pubState = { query: gmail.DEFAULT_QUERY, rows: null, loading: false, error: "", progress: null, lastFetch: 0 };

// --- Cache local das publicações (para não sumirem ao fechar o app) ---
// Guardamos no aparelho as publicações já buscadas. Ao atualizar, mesclamos as
// novas com as existentes SEM duplicar (chave = id da mensagem do Gmail). O
// vínculo com processo/cliente NÃO é guardado — é recalculado a cada abertura,
// então fica sempre atualizado conforme você cadastra processos.
const PUB_CACHE_KEY = "assist:publicacoes";
const PUB_CACHE_MAX = 400;      // guarda no máx. as 400 mais recentes
const PUB_TEOR_MAX = 12000;     // limita o tamanho do teor guardado

function loadPubCache() {
  try { const v = JSON.parse(localStorage.getItem(PUB_CACHE_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function savePubCache(rows) {
  try {
    const enxuto = rows.slice(0, PUB_CACHE_MAX).map((r) => ({
      id: r.id, threadId: r.threadId, subject: r.subject, from: r.from, dateMs: r.dateMs,
      snippet: r.snippet, teor: (r.teor || "").slice(0, PUB_TEOR_MAX), link: r.link,
      numero: r.numero, orgao: r.orgao, classe: r.classe, assunto: r.assunto,
      evento: r.evento, partes: r.partes, prazo: r.prazo, disponibilizacao: r.disponibilizacao,
    }));
    localStorage.setItem(PUB_CACHE_KEY, JSON.stringify(enxuto));
  } catch { /* cota estourada: ignora silenciosamente */ }
}
// Mescla listas por id (novas entram, existentes permanecem; sem duplicar).
// A versão recém-buscada tem prioridade (dados mais frescos).
function mesclarPubs(existentes, novas) {
  const byId = new Map();
  (existentes || []).forEach((p) => { if (p && p.id) byId.set(p.id, p); });
  (novas || []).forEach((p) => { if (p && p.id) byId.set(p.id, p); });
  return [...byId.values()].sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
}

// Normaliza para comparar nomes: sem acento, minúsculo, só letras/números.
const normNome = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
// Conectivos que não contam como "parte" do nome (de, da, e, …).
const NOME_CONN = new Set(["de", "da", "do", "das", "dos", "e", "van", "von", "del", "la"]);
const nomeTokens = (nome) => normNome(nome).split(" ").filter((t) => t.length >= 3 && !NOME_CONN.has(t));
// O cliente é citado nas partes? Casa por PALAVRA INTEIRA (não substring, senão
// "liz" casaria dentro de "realizado"/"atualização"). Exige nome+sobrenome e
// que TODOS os tokens significativos apareçam como palavras (tolera ordem
// trocada). `haySet` é o conjunto de palavras do campo de partes.
function clienteCitado(client, haySet) {
  const toks = nomeTokens(client.nome);
  if (toks.length < 2) return false;
  return toks.every((t) => haySet.has(t));
}

const procClientIds = (p) => [...new Set([p.client_id, ...(Array.isArray(p.client_ids) ? p.client_ids : [])].filter(Boolean))];

// CNJ só com os 20 dígitos (descarta pontuação e eventual lixo antes). Vazio se
// não for um número completo.
function cnjKey(s) {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 20 ? d.slice(-20) : "";
}

// Casa a publicação com processo/cliente cadastrados.
// via: "cnj" (preciso) | "nome" (fallback, confira) | null (sem vínculo).
// Devolve { proc, clientes[], via, ambiguo }.
function vincularPublicacao(r, procs, clients) {
  // 1) Pelo número do processo (CNJ) — igualdade EXATA dos 20 dígitos.
  const alvo = cnjKey(r.numero);
  if (alvo) {
    const proc = procs.find((p) => cnjKey(p.num) === alvo);
    if (proc) {
      const clientes = procClientIds(proc).map((id) => clients.find((c) => c.id === id)).filter(Boolean);
      return { proc, clientes, via: "cnj", ambiguo: false };
    }
  }

  // 2) Fallback pelo nome — SOMENTE no campo de partes, por palavra inteira.
  // Identifica apenas o CLIENTE; NUNCA adivinha o processo (o cliente pode ter
  // vários casos, e esta publicação é de UM deles — só o CNJ diz qual). Antes o
  // app "chutava" o único processo do cliente e grudava em publicações de outros
  // casos (o problema da cliente Liz).
  const haySet = new Set(normNome(r.partes).split(" ").filter(Boolean));
  if (!haySet.size) return { proc: null, clientes: [], via: null, ambiguo: false };
  const citados = clients.filter((c) => clienteCitado(c, haySet));
  if (!citados.length) return { proc: null, clientes: [], via: null, ambiguo: false };
  return { proc: null, clientes: citados, via: "nome", ambiguo: false };
}

async function renderPublicacoes() {
  const main = $("#main");
  main.innerHTML = "";

  const head = el("div", {}, [
    el("h1", { class: "page-title" }, "Publicações oficiais"),
    el("p", { class: "page-sub" }, "Movimentações processuais (EPROC) buscadas no seu Gmail"),
  ]);

  if (!gmail.googleEnabled()) {
    main.append(head, el("div", { class: "empty" }, "Para usar esta aba, configure o Google (GOOGLE_CLIENT_ID) — veja o README."));
    return;
  }

  // Na primeira vez, carrega as publicações guardadas no aparelho (para
  // aparecerem imediatamente, mesmo sem reconectar o Gmail).
  if (pubState.rows == null) pubState.rows = loadPubCache();

  // Vincula cada publicação ao processo/cliente cadastrados (automático, por CNJ).
  if (pubState.rows && pubState.rows.length) {
    try {
      const [procs, clients] = await Promise.all([list("processes"), list("clients")]);
      // Vínculo 100% AUTOMÁTICO: recalculado a cada abertura (por CNJ; o nome só
      // identifica o cliente). Ignora marcações manuais antigas — assim tudo se
      // religa sozinho conforme você cadastra/corrige processos e clientes.
      pubState.rows.forEach((r) => {
        // Reextrai os campos com o parser mais novo (corrige números já guardados
        // no cache — ex.: número solto pego do topo do e-mail).
        try { if (r.teor || r.subject) Object.assign(r, gmail.parseTeor(r.subject, r.teor)); } catch {}
        r.vinculo = vincularPublicacao(r, procs, clients);
      });
      try { savePubCache(pubState.rows); } catch {}
    } catch { /* se falhar, segue sem vínculo */ }
  }

  const temCache = pubState.rows && pubState.rows.length > 0;

  // Barra de conexão / ações
  const bar = el("div", { class: "gbar" });
  if (!gmail.isConnected()) {
    bar.append(
      el("span", { class: "t2" }, temCache
        ? "Conecte o Gmail para buscar novas publicações."
        : "Conecte seu Gmail para trazer as publicações do EPROC."),
      el("button", { class: "btn btn-sm btn-primary", onclick: async () => {
        try { await gmail.connect(true); loadPublicacoes(); }
        catch (e) { toast("Não foi possível conectar ao Gmail. " + (e.message || "")); }
      } }, temCache ? "🔗 Conectar e atualizar" : "🔗 Conectar Gmail"),
    );
  } else {
    bar.append(
      el("span", { class: "t2" }, pubState.loading
        ? ("🔄 Buscando… " + (pubState.progress ? `${pubState.progress.done}/${pubState.progress.total}` : ""))
        : "✅ Gmail conectado"),
      el("div", { style: "display:flex; gap:8px" }, [
        el("button", { class: "btn btn-sm btn-primary", onclick: () => loadPublicacoes(), disabled: pubState.loading ? "" : null }, "↻ Atualizar"),
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => { gmail.disconnect(); renderPublicacoes(); } }, "Desconectar"),
      ]),
    );
  }

  // Campo de busca (refina a query do Gmail)
  const search = el("input", { class: "form-control search-box", value: pubState.query, placeholder: "Filtro do Gmail (ex: eproc \"movimentações processuais\")" });
  search.addEventListener("change", () => { pubState.query = search.value.trim() || gmail.DEFAULT_QUERY; });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { pubState.query = search.value.trim() || gmail.DEFAULT_QUERY; loadPublicacoes(); } });

  main.append(head, bar);
  if (gmail.isConnected() || temCache) main.append(search);

  // Corpo: erro, tabela (cache ou recém-buscada) e/ou avisos.
  if (pubState.error) main.append(el("div", { class: "empty" }, pubState.error));

  if (temCache) {
    main.append(pubTable(pubState.rows));
  } else if (pubState.loading) {
    main.append(el("div", { class: "empty" }, "Buscando suas publicações no Gmail…"));
  } else if (pubState.rows && pubState.rows.length === 0 && !pubState.error) {
    main.append(el("div", { class: "empty" }, gmail.isConnected() ? "Nenhum e-mail encontrado com esse filtro." : "Nenhuma publicação guardada ainda. Conecte o Gmail para buscar."));
  }

  // Uma vez por sessão, se o Gmail estiver conectado, busca novas em segundo
  // plano e mescla com o cache (o cache já está visível; nada some).
  // Rebusca automaticamente ao abrir/voltar à aba, se o Gmail estiver conectado
  // e já passou o intervalo mínimo (evita buscar toda hora). Assim, ao reabrir o
  // app, as publicações novas do dia entram sozinhas (mesclando, sem duplicar).
  if (gmail.isConnected() && !pubState.loading && !pubState.error && (Date.now() - (pubState.lastFetch || 0) > 60000)) {
    loadPublicacoes();
  }
}

async function loadPublicacoes() {
  if (pubState.loading) return;
  pubState.loading = true; pubState.error = ""; pubState.progress = null;
  if (state.route === "publicacoes") renderPublicacoes();
  try {
    const novas = await gmail.fetchPublicacoes(pubState.query, {
      max: 80,
      onProgress: (done, total) => {
        pubState.progress = { done, total };
        if (state.route === "publicacoes") {
          const bar = $("#main .gbar .t2");
          if (bar && pubState.loading) bar.textContent = `🔄 Buscando… ${done}/${total}`;
        }
      },
    });
    // Mescla com o que já estava guardado (sem duplicar) e persiste.
    const antes = (pubState.rows && pubState.rows.length) ? pubState.rows : loadPubCache();
    const antesN = antes.length;
    pubState.rows = mesclarPubs(antes, novas);
    savePubCache(pubState.rows);
    const adicionadas = pubState.rows.length - antesN;
    if (adicionadas > 0) toast(`✅ ${adicionadas} nova${adicionadas === 1 ? "" : "s"} publicaç${adicionadas === 1 ? "ão" : "ões"}.`);
    else toast("Tudo atualizado — nenhuma publicação nova.");
  } catch (e) {
    pubState.error = e.message || "Falha ao buscar no Gmail.";
    if (pubState.rows == null) pubState.rows = loadPubCache();
  } finally {
    pubState.loading = false; pubState.progress = null; pubState.lastFetch = Date.now();
    if (state.route === "publicacoes") renderPublicacoes();
  }
}

// Célula com o vínculo (cliente + processo cadastrados). Clicável: abre o
// processo (ou o cliente, quando o processo é ambíguo). Vínculos por nome vêm
// marcados com "por nome" para você conferir.
function vinculoCell(r) {
  const v = r.vinculo || { proc: null, clientes: [], via: null };
  const nomes = v.clientes.map((c) => c.nome).join(", ");
  const porNome = v.via === "nome" ? el("span", { class: "pub-vtag" }, "por nome") : null;

  // Sem nenhum vínculo.
  if (!v.proc && !v.clientes.length) {
    return el("td", { class: "pub-vinc" }, (r.numero || r.partes)
      ? el("span", { class: "pub-naovinc" }, "Não cadastrado")
      : "—");
  }
  // Processo identificado (por CNJ ou por nome com processo único).
  if (v.proc) {
    return el("td", { class: "pub-vinc" }, [
      el("button", {
        class: "pub-link", title: "Abrir o processo cadastrado",
        onclick: () => openProcess(v.proc.id, () => navigate("publicacoes")),
      }, [
        nomes ? el("span", { class: "pub-cli" }, "👤 " + nomes) : null,
        el("span", { class: "pub-proc" }, "⚖️ " + (v.proc.nome || v.proc.num || "Processo")),
      ].filter(Boolean)),
      porNome,
    ]);
  }
  // Só cliente (nome casou, mas ele tem vários processos — não dá pra escolher).
  return el("td", { class: "pub-vinc" }, [
    el("button", {
      class: "pub-link", title: "Abrir o cliente",
      onclick: () => openClient(v.clientes[0].id),
    }, [el("span", { class: "pub-cli" }, "👤 " + nomes)]),
    el("span", { class: "pub-proc pub-naovinc" }, v.ambiguo ? "vários processos" : "sem processo"),
    porNome,
  ]);
}

function pubTable(rows) {
  const COLS = [
    "Data", "Processo", "Cliente / Processo", "Órgão / Vara",
    "Classe", "Evento", "Prazo", "Partes", "Assunto do e-mail", "Teor",
  ];
  const thead = el("tr", {}, COLS.map((label) => el("th", {}, label)));
  const body = el("tbody", {});
  const vinculadas = rows.filter((r) => r.vinculo?.proc || r.vinculo?.clientes?.length).length;
  rows.forEach((r) => {
    const dataTxt = r.dateMs ? new Date(r.dateMs).toLocaleDateString("pt-BR") : "";
    const teorCell = el("td", { class: "pub-teor" }, [
      el("button", { class: "btn btn-ghost btn-sm", onclick: () => openPublicacao(r) }, "Ver teor"),
    ]);
    const cells = [
      el("td", {}, dataTxt),
      el("td", {}, r.numero ? el("span", { class: "mono" }, r.numero) : "—"),
      vinculoCell(r),
      el("td", {}, r.orgao || "—"),
      el("td", {}, r.classe || "—"),
      el("td", {}, r.evento || "—"),
      el("td", {}, r.prazo || "—"),
      el("td", {}, r.partes || "—"),
      el("td", {}, r.subject || "—"),
      teorCell,
    ];
    body.append(el("tr", { class: r.vinculo?.proc ? "pub-row-vinc" : "" }, cells));
  });
  const table = el("table", { class: "pub-table" }, [el("thead", {}, thead), body]);
  return el("div", {}, [
    el("p", { class: "page-sub", style: "margin:2px 0 8px" }, `${rows.length} publicaç${rows.length === 1 ? "ão" : "ões"} · ${vinculadas} vinculada${vinculadas === 1 ? "" : "s"} a processo cadastrado. Arraste a tabela para o lado para ver todas as colunas.`),
    el("div", { class: "wk-scroll" }, table),
  ]);
}

function openPublicacao(r) {
  const dataTxt = r.dateMs ? new Date(r.dateMs).toLocaleString("pt-BR") : "";
  const v = r.vinculo || { proc: null, clientes: [] };
  const nomesCli = v.clientes.map((c) => c.nome).join(", ");
  const linhas = [
    ["Data", dataTxt], ["Processo", r.numero],
    ["Cliente vinculado", nomesCli], ["Processo vinculado", v.proc ? (v.proc.nome || v.proc.num) : ""],
    ["Órgão / Vara", r.orgao], ["Classe", r.classe], ["Assunto", r.assunto],
    ["Evento / Movimento", r.evento], ["Prazo", r.prazo], ["Disponibilização", r.disponibilizacao],
    ["Partes", r.partes], ["Remetente", r.from], ["Assunto do e-mail", r.subject],
  ].filter(([, val]) => val);
  const kv = el("dl", { class: "pub-kv" });
  linhas.forEach(([k, val]) => { kv.append(el("dt", {}, k), el("dd", {}, val)); });

  // Faixa de vínculo (automático). Três casos: processo identificado por CNJ;
  // só cliente (nome casou, mas o processo daquela publicação não está
  // cadastrado); ou nada reconhecido.
  const porNomeAviso = v.via === "nome" ? " (identificado pelo nome das partes)" : "";
  let vincBox;
  if (v.proc) {
    const numDif = v.proc.num && cnjKey(v.proc.num) !== cnjKey(r.numero);
    vincBox = el("div", { class: "pub-vinc-box ok" }, [
      el("span", {}, "🔗 Vinculado a " + (nomesCli ? nomesCli + " · " : "") + (v.proc.nome || v.proc.num) + (v.proc.num ? " (nº " + v.proc.num + ")" : "") + porNomeAviso),
      numDif ? el("span", { class: "pub-naovinc" }, "⚠️ O nº do processo cadastrado é diferente do nº desta publicação — confira o cadastro do processo (nº ou cliente pode estar trocado).") : null,
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
        el("button", { class: "btn btn-sm", onclick: () => { closeModal(); openProcess(v.proc.id, () => navigate("publicacoes")); } }, "⚖️ Abrir processo"),
        v.clientes[0] ? el("button", { class: "btn btn-sm btn-ghost", onclick: () => { closeModal(); openClient(v.clientes[0].id); } }, "👤 Abrir cliente") : null,
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => lancarAndamento(r, v.proc) }, "➕ Lançar como andamento"),
      ].filter(Boolean)),
    ].filter(Boolean));
  } else if (v.clientes.length) {
    vincBox = el("div", { class: "pub-vinc-box ok" }, [
      el("span", {}, "🔗 Cliente identificado pelo nome das partes: " + nomesCli + ". O processo será vinculado sozinho assim que houver um cadastrado com este número (" + (r.numero || "sem nº") + ")."),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
        el("button", { class: "btn btn-sm", onclick: () => { closeModal(); openClient(v.clientes[0].id); } }, "👤 Abrir cliente"),
      ]),
    ]);
  } else {
    vincBox = el("div", { class: "pub-vinc-box warn" }, r.numero
      ? "Nenhum processo cadastrado com o nº " + r.numero + ", e não reconheci as partes entre seus clientes. Assim que você cadastrar o processo/cliente, esta publicação se vincula sozinha."
      : "Não reconheci as partes desta publicação entre seus clientes cadastrados.");
  }

  const content = el("div", {}, [
    el("h3", {}, "Teor da publicação"),
    vincBox,
    kv,
    el("div", { class: "group-head", style: "margin-top:12px" }, "Teor completo"),
    el("pre", { class: "pub-teor-full" }, r.teor || "(sem conteúdo)"),
    el("div", { class: "modal-actions" }, [
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "Fechar"),
      el("a", { class: "btn btn-primary", href: r.link, target: "_blank", rel: "noopener" }, "Abrir no Gmail"),
    ]),
  ]);
  openModal(content);
}

// Lança a publicação como um andamento do processo vinculado (linha do tempo).
async function lancarAndamento(r, proc) {
  const dataISO = r.dateMs ? new Date(r.dateMs).toISOString().slice(0, 10) : todayISO();
  const partes = [r.evento, r.classe].filter(Boolean).join(" — ");
  const teorCurto = (r.teor || r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const texto = "📬 Publicação (EPROC): " + (partes ? partes + ". " : "") + teorCurto + (r.prazo ? " [Prazo: " + r.prazo + "]" : "");
  try {
    const ands = Array.isArray(proc.andamentos) ? proc.andamentos : [];
    // Evita duplicar: se já houver um andamento com o mesmo id da publicação, não repete.
    if (ands.some((a) => a && a.pubId === r.id)) { toast("Esta publicação já foi lançada neste processo."); return; }
    const novo = { data: dataISO, hora: "", texto, pubId: r.id };
    await update("processes", proc.id, { andamentos: [...ands, novo] });
    toast("✅ Andamento lançado em " + (proc.nome || proc.num) + ".");
    closeModal();
  } catch (e) {
    toast("Não foi possível lançar o andamento. " + (e.message || ""));
  }
}

// ==================== GERAR DOCUMENTOS ====================
// Gera procuração (judicial/extrajudicial) e declaração de hipossuficiência a
// partir dos modelos .docx, preenchendo com os dados da parte. Os dados podem
// vir de um cliente já cadastrado, de documentos anexados (CNH/RG/comprovante) ou
// digitados. O arquivo gerado sai igual ao modelo e é baixado.
// preset (opcional, vindo da IA): { clientId, docs: [], objeto, situacao } — abre
// o gerador já com o cliente e o(s) tipo(s) de documento escolhidos.
async function renderGerarDocs(preset) {
  loading();
  const clients = await list("clients", { orderBy: "nome", asc: true });
  const main = $("#main");
  main.innerHTML = "";

  // ---- estado do formulário (só o que consta na procuração modelo) ----
  const dados = { nome: "", nacionalidade: "", estadoCivil: "", profissao: "", cpf: "", rg: "", endereco: "", objeto: "", situacao: "", dataISO: todayISO() };

  const inp = (ph, key, attrs = {}) => { const e = el("input", { class: "form-control", placeholder: ph, value: dados[key] || "", ...attrs }); e.addEventListener("input", () => { dados[key] = e.value; }); return e; };
  const nome = inp("Nome completo *", "nome");
  const cpf = inp("000.000.000-00", "cpf");
  const rg = inp("RG", "rg");
  const endereco = inp("Rua, nº, bairro, cidade — UF", "endereco");
  const nacionalidade = inp("brasileira / brasileiro", "nacionalidade");
  const estadoCivil = inp("Ex: casada, solteiro, divorciado…", "estadoCivil");
  const profissao = inp("Ex: professora, empresário…", "profissao");

  const data = el("input", { class: "form-control", type: "date", value: dados.dataISO }); data.addEventListener("input", () => { dados.dataISO = data.value; });
  const objeto = el("textarea", { class: "form-control", rows: "2", placeholder: "Ex: à ação de cobrança, ajuizada em desfavor de Fulano de Tal." }); objeto.addEventListener("input", () => { dados.objeto = objeto.value; });
  const situacao = inp("Ex: aposentada, desempregado… (padrão: a profissão)", "situacao");

  // preencher a partir de um cliente já cadastrado
  const cliSel = el("select", { class: "form-control" });
  cliSel.append(el("option", { value: "" }, "— preencher manualmente / por documento —"));
  clients.forEach((c) => cliSel.append(el("option", { value: c.id }, c.nome)));
  const aplicarCliente = (c) => {
    const obs = c.obs || "";
    const fromObs = (re) => { const m = obs.match(re); return m ? m[1].trim() : ""; };
    dados.nome = c.nome || ""; dados.cpf = c.cpf || ""; dados.rg = c.rg || ""; dados.endereco = c.endereco || "";
    dados.nacionalidade = c.nacionalidade || fromObs(/nacionalidade\/?\w*:\s*([^·\n]+)/i);
    dados.profissao = c.profissao || fromObs(/profiss[ãa]o:\s*([^·\n]+)/i);
    dados.estadoCivil = c.estado_civil || fromObs(/estado civil:\s*([^·\n]+)/i);
    [[nome, "nome"], [cpf, "cpf"], [rg, "rg"], [endereco, "endereco"], [nacionalidade, "nacionalidade"], [estadoCivil, "estadoCivil"], [profissao, "profissao"]].forEach(([node, k]) => { node.value = dados[k]; });
  };
  cliSel.addEventListener("change", () => { const c = clients.find((x) => x.id === cliSel.value); if (c) aplicarCliente(c); });

  // preencher a partir de documentos (CNH/RG/comprovante) — lê e completa
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,text/plain", multiple: "" });
  const docStatus = el("div", { class: "capture-status" });
  const upBtn = el("button", { type: "button", class: "cap-btn" }, "📎 Ler documentos (CNH, RG, comprovante…)");
  upBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = [...fileInput.files]; fileInput.value = "";
    let texto = "";
    for (const f of files) {
      docStatus.textContent = `📄 Lendo “${f.name}”…`;
      try { texto += "\n" + (await extractTextFromFile(f, (m) => { docStatus.textContent = m; }) || ""); } catch {}
    }
    if (!texto.trim()) { docStatus.textContent = "⚠️ Não consegui ler texto dos arquivos."; return; }
    let ex = null;
    if (aiEnabled()) { docStatus.textContent = "🤖 Lendo com IA…"; try { const ai = await aiExtract(texto, ["cliente"]); if (ai && ai.clientes && ai.clientes[0]) ex = ai.clientes[0]; } catch {} }
    if (!ex) ex = extractClient(texto);
    const set = (key, node, val) => { if (val) { dados[key] = val; node.value = val; } };
    set("nome", nome, ex.nome); set("cpf", cpf, ex.cpf); set("rg", rg, ex.rg); set("endereco", endereco, ex.endereco);
    set("nacionalidade", nacionalidade, ex.nacionalidade); set("estadoCivil", estadoCivil, ex.estado_civil); set("profissao", profissao, ex.profissao);
    docStatus.textContent = "✅ Dados lidos do documento. Confira e complete abaixo.";
  };

  // seleção de documentos a gerar
  const escolhidos = new Set();
  const tipoBtns = el("div", { class: "cap-types" });
  DOCS.forEach((doc) => {
    const b = el("button", { type: "button", class: "cap-type", "data-k": doc.key }, [el("span", { class: "cap-ico" }, doc.ico), doc.label]);
    b.onclick = () => { escolhidos.has(doc.key) ? escolhidos.delete(doc.key) : escolhidos.add(doc.key); b.classList.toggle("active"); atualizarCondicionais(); };
    tipoBtns.append(b);
  });
  const objetoField = lbl("Objeto da procuração judicial (a ação, o pedido, contra quem)", objeto);
  const situacaoField = lbl("Situação para a hipossuficiência", situacao);
  const atualizarCondicionais = () => {
    objetoField.style.display = escolhidos.has("procuracao_judicial") ? "" : "none";
    situacaoField.style.display = escolhidos.has("declaracao") ? "" : "none";
  };

  const gerarBtn = el("button", { type: "button", class: "btn btn-primary btn-block" }, "📄 Gerar e baixar");
  gerarBtn.onclick = async () => {
    if (!dados.nome.trim()) { toast("Informe o nome da parte."); nome.focus(); return; }
    if (!escolhidos.size) { toast("Escolha ao menos um documento para gerar."); return; }
    if (escolhidos.has("procuracao_judicial") && !dados.objeto.trim()) { toast("Descreva o objeto da procuração judicial."); objeto.focus(); return; }
    gerarBtn.disabled = true; gerarBtn.textContent = "Gerando…";
    try {
      await gerarDocumentos([...escolhidos], dados);
      toast("✅ Documento(s) gerado(s). Verifique os downloads.");
    } catch (e) {
      toast("Não consegui gerar: " + (e?.message || e));
    } finally { gerarBtn.disabled = false; gerarBtn.textContent = "📄 Gerar e baixar"; }
  };

  main.append(
    el("div", {}, [el("h1", { class: "page-title" }, "Gerar Documentos"), el("p", { class: "page-sub" }, "Procuração e declaração de hipossuficiência, prontas e no seu modelo")]),
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "1. Dados da parte"),
      lbl("Usar um cliente já cadastrado", cliSel),
      el("div", { style: "margin:8px 0" }, [upBtn, docStatus, fileInput]),
      lbl("Nome completo *", nome),
      el("div", { class: "cap-row" }, [lbl("Nacionalidade", nacionalidade), lbl("Estado civil", estadoCivil), lbl("Profissão", profissao)]),
      el("div", { class: "cap-row" }, [lbl("CPF", cpf), lbl("RG", rg)]),
      lbl("Endereço", endereco),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "2. Quais documentos gerar"),
      tipoBtns,
      objetoField,
      situacaoField,
      lbl("Data do documento", data),
    ]),
    el("div", { style: "margin-top:4px" }, [gerarBtn]),
    el("p", { class: "t2", style: "margin-top:10px" }, "Os outorgados (seu escritório) e o texto dos poderes vêm prontos do modelo. Confira o documento gerado antes de assinar."),
  );
  atualizarCondicionais();

  // Pré-preenchimento vindo da IA ("faça uma procuração para a Liz"): seleciona o
  // cliente, marca o(s) documento(s) e já rola até o botão de gerar.
  const presetCli = preset && (preset.clienteId || preset.clientId);
  if (preset && (presetCli || (preset.docs && preset.docs.length) || preset.objeto)) {
    const c = presetCli ? clients.find((x) => x.id === presetCli) : null;
    if (c) { cliSel.value = c.id; aplicarCliente(c); }
    (preset.docs || []).forEach((k) => {
      if (!DOCS.some((d) => d.key === k) || escolhidos.has(k)) return;
      escolhidos.add(k);
      const btn = tipoBtns.querySelector(`[data-k="${k}"]`);
      if (btn) btn.classList.add("active");
    });
    if (preset.objeto) { dados.objeto = preset.objeto; objeto.value = preset.objeto; }
    if (preset.situacao) { dados.situacao = preset.situacao; situacao.value = preset.situacao; }
    atualizarCondicionais();
    const quem = c ? ` de ${c.nome}` : "";
    const oQue = (preset.docs && preset.docs.length) ? preset.docs.map((k) => (DOCS.find((d) => d.key === k) || {}).label || k).join(" e ") : "documento";
    toast(`📄 ${oQue}${quem} pronta para gerar. Confira os dados e toque em “Gerar e baixar”.`, { duration: 8000 });
    if (escolhidos.has("procuracao_judicial") && !dados.objeto.trim()) setTimeout(() => objeto.focus(), 60);
    else setTimeout(() => gerarBtn.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
  removeFab();
}

// ==================== ANEXOS (arquivos embutidos na tarefa) ====================
const MAX_ANEXO = 8 * 1024 * 1024; // 8 MB por arquivo
function fmtBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function iconForType(type, name) {
  const t = (type || "") + " " + (name || "").toLowerCase();
  if (/image\//.test(type) || /\.(png|jpe?g|gif|webp|heic)$/.test(name || "")) return "🖼️";
  if (/pdf/.test(t)) return "📕";
  if (/word|\.docx?$/.test(t)) return "📘";
  if (/sheet|excel|\.xlsx?$|\.csv$/.test(t)) return "📊";
  if (/audio\//.test(type)) return "🎵";
  if (/video\//.test(type)) return "🎬";
  return "📄";
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("erro ao ler o arquivo"));
    r.readAsDataURL(file);
  });
}
// Lê os arquivos escolhidos e devolve os anexos válidos (respeitando o limite de tamanho).
async function filesToAttachments(fileList, onWarn) {
  const out = [];
  for (const file of fileList) {
    if (file.size > MAX_ANEXO) { onWarn && onWarn(`"${file.name}" tem ${fmtBytes(file.size)} — o limite é ${fmtBytes(MAX_ANEXO)}.`); continue; }
    try {
      const data = await readFileAsDataURL(file);
      out.push({ name: file.name, type: file.type || "", size: file.size, data });
    } catch { onWarn && onWarn(`Não consegui ler "${file.name}".`); }
  }
  return out;
}
// Abre/baixa um anexo (data URL) de forma confiável em qualquer navegador.
function openAttachment(a) {
  try {
    const link = el("a", { href: a.data, download: a.name || "arquivo" });
    document.body.append(link); link.click(); link.remove();
  } catch { toast("Não foi possível abrir o anexo."); }
}

// Cartão de documentos (anexos) reutilizável — usado nas pastas de cliente e
// processo. Mesma UX dos anexos de tarefa: listar, abrir, remover e adicionar.
function attachmentsCard(table, record) {
  let atts = Array.isArray(record.attachments) ? record.attachments.slice() : [];
  const titleEl = el("div", { class: "card-title" }, "");
  const listEl = el("div", { class: "att-list" });
  const input = el("input", { type: "file", class: "hidden", multiple: "" });
  const addBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "📎 Anexar documento");
  const draw = () => {
    titleEl.textContent = `Documentos (${atts.length})`;
    listEl.innerHTML = "";
    if (!atts.length) { listEl.append(el("div", { class: "t2" }, "Nenhum documento anexado.")); return; }
    atts.forEach((a, i) => listEl.append(el("div", { class: "att-item" }, [
      el("span", { class: "att-ico" }, iconForType(a.type, a.name)),
      el("span", { class: "att-name grow", onclick: () => openAttachment(a) }, a.name),
      el("span", { class: "att-size t2" }, fmtBytes(a.size)),
      el("button", { type: "button", class: "del", title: "Remover", onclick: async () => {
        const [removido] = atts.splice(i, 1);
        try { await update(table, record.id, { attachments: atts }); }
        catch (e) { atts.splice(i, 0, removido); toast("Não consegui remover o documento. " + (e?.message || "")); }
        draw();
      } }, "×"),
    ])));
  };
  addBtn.onclick = () => input.click();
  input.onchange = async () => {
    const chosen = [...input.files]; input.value = "";
    addBtn.disabled = true; addBtn.textContent = "Lendo…";
    const novos = await filesToAttachments(chosen, (m) => toast(m));
    atts = atts.concat(novos);
    try { await update(table, record.id, { attachments: atts }); } catch (e) { toast("Não consegui salvar (arquivo grande?). " + (e?.message || "")); }
    addBtn.disabled = false; addBtn.textContent = "📎 Anexar documento";
    draw();
  };
  draw();
  return el("div", { class: "card" }, [
    titleEl, listEl,
    el("div", { style: "margin-top:8px" }, [addBtn, el("div", { class: "t2", style: "margin-top:4px" }, "Até 8 MB por arquivo (PDF, imagem, documento…).")]),
    input,
  ]);
}

// ==================== HELPERS ====================
function stat(label, value, cls = "") {
  return el("div", { class: "stat" }, [
    el("div", { class: "label" }, label),
    el("div", { class: "value " + cls }, value),
  ]);
}
function refresh() { navigate(state.route); }
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// ==================== SERVICE WORKER ====================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
