import { initSupabase, isCloud, list, insert, update, remove } from "./store.js";
import { getSession, signIn, signUp, signOut, enterLocal, onAuthChange } from "./auth.js";
import { $, $$, el, todayISO, prettyDate, openModal, closeModal, toast } from "./ui.js";
import { mountCapture } from "./capture.js";
import { detectColumns, matchClient, buildProcessFromRow, parseCSV, inferGrau, extractProcessesFromText } from "./planilha.js";
import { extractTextFromFile } from "./files.js";
import * as gcal from "./gcal.js";

let state = { route: "dashboard" };

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
  $$(".tabbar-btn").forEach((b) =>
    b.addEventListener("click", () => navigate(b.dataset.route))
  );
  $("#logout-btn").onclick = async () => { await signOut(); if (!isCloud()) showAuth(); };
}

function navigate(route) {
  state.route = route;
  $$(".tabbar-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  removeFab();
  const routes = { dashboard: renderDashboard, agenda: renderAgenda, clients: renderClients, processes: renderProcesses, personal: renderTasksPage, professional: renderTasksPage, reminders: renderReminders, notes: renderNotes };
  (routes[route] || renderDashboard)();
}

function removeFab() { const f = $(".fab"); if (f) f.remove(); }
function addFab(onClick) {
  removeFab();
  document.body.append(el("button", { class: "fab", onclick: onClick }, "+"));
}
function loading() { $("#main").innerHTML = '<div class="empty">Carregando…</div>'; }

// ==================== DASHBOARD ====================
async function renderDashboard() {
  loading();
  const [tasks, notes, reminders] = await Promise.all([
    list("tasks", { orderBy: "created_at", asc: true }),
    list("notes"),
    list("reminders"),
  ]);

  const today = todayISO();
  const pending = tasks.filter((t) => !t.done);
  const dueToday = pending.filter((t) => t.due_date === today);
  const overdue = pending.filter((t) => t.due_date && t.due_date < today);
  const personalOpen = pending.filter((t) => (t.area || "pessoal") === "pessoal");
  const workOpen = pending.filter((t) => t.area === "profissional");
  const upcomingReminders = sortReminders(reminders).filter((r) => !r.remind_on || r.remind_on >= today).slice(0, 3);

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h1", { class: "page-title" }, saudacao()),
        el("p", { class: "page-sub" }, resumoLinha(pending.length, overdue.length)),
      ]),
    ]),
    captureCard(),
    el("div", { class: "stat-grid" }, [
      stat("Abertas", String(pending.length)),
      stat("Atrasadas", String(overdue.length), overdue.length ? "neg" : ""),
      stat("Concluídas", String(tasks.filter((t) => t.done).length), "pos"),
    ]),
    dashCard("📌 Para hoje", "Ver tarefas", "personal",
      dueToday.length || overdue.length
        ? el("div", { class: "list" }, [
            ...overdue.slice(0, 4).map((t) => taskRow(t, true)),
            ...dueToday.slice(0, 4).map((t) => taskRow(t, true)),
          ])
        : el("div", { class: "empty" }, "Nada para hoje. Tudo em dia! 🎉")),
    dashCard("🧑 Pessoal", "Ver tudo", "personal",
      personalOpen.length
        ? el("div", { class: "list" }, sortTasks(personalOpen).slice(0, 3).map((t) => taskRow(t, true)))
        : el("div", { class: "empty" }, "Sem tarefas pessoais abertas.")),
    dashCard("💼 Trabalho", "Ver tudo", "professional",
      workOpen.length
        ? el("div", { class: "list" }, sortTasks(workOpen).slice(0, 3).map((t) => taskRow(t, true)))
        : el("div", { class: "empty" }, "Sem tarefas de trabalho abertas.")),
    dashCard("🔔 Lembretes", "Ver tudo", "reminders",
      upcomingReminders.length
        ? el("div", { class: "list" }, upcomingReminders.map((r) => reminderRow(r, true)))
        : el("div", { class: "empty" }, "Nenhum lembrete próximo.")),
    dashCard("📝 Notas", "Ver tudo", "notes",
      notes.length
        ? el("div", { class: "list" }, notes.slice(0, 3).map((n) =>
            el("div", { class: "row" }, [
              el("div", { class: "grow" }, [
                el("div", { class: "t1" }, n.title || "Sem título"),
                n.body ? el("div", { class: "t2" }, n.body) : null,
              ]),
            ])))
        : el("div", { class: "empty" }, "Nenhuma nota ainda.")),
  );
}

function resumoLinha(abertas, atrasadas) {
  if (abertas === 0) return "Tudo em dia! Nenhuma tarefa aberta. 🎉";
  const base = `${abertas} tarefa${abertas > 1 ? "s" : ""} aberta${abertas > 1 ? "s" : ""}`;
  return atrasadas ? `${base} · ${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : base;
}

function captureCard() {
  const onCreate = async (task) => {
    const saved = await insert("tasks", task);
    renderDashboard();
    return saved;
  };
  // permite desfazer o último cadastro
  onCreate.__undo = async (saved) => {
    if (saved && saved.id) { await remove("tasks", saved.id); renderDashboard(); toast("Cadastro desfeito."); }
  };
  return mountCapture(state.route === "professional" ? "profissional" : "pessoal", onCreate);
}

function dashCard(title, linkLabel, route, body) {
  return el("div", { class: "card" }, [
    el("div", { class: "section-head", style: "margin-bottom:12px" }, [
      el("div", { class: "card-title", style: "margin:0" }, title),
      el("button", { class: "btn btn-ghost btn-sm", onclick: () => navigate(route) }, linkLabel),
    ]),
    body,
  ]);
}

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia ☀️";
  if (h < 18) return "Boa tarde 🌤️";
  return "Boa noite 🌙";
}

// ==================== TAREFAS (Pessoal / Profissional) ====================
async function renderTasksPage() {
  loading();
  const area = state.route === "professional" ? "profissional" : "pessoal";
  const meta = area === "profissional"
    ? { title: "Trabalho 💼", sub: "Projetos, prazos e compromissos" }
    : { title: "Meu cadastro pessoal 🧑", sub: "Suas tarefas e prazos pessoais — só seus, fora das pastas de clientes" };
  const all = await list("tasks", { orderBy: "created_at", asc: true });
  const tasks = all.filter((t) => (t.area || "pessoal") === area);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", {}, [el("h1", { class: "page-title" }, meta.title), el("p", { class: "page-sub" }, meta.sub)]),
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
    t.description ? el("div", { class: "t2" }, t.description) : null,
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
  const desc = el("textarea", { class: "form-control", rows: "2", placeholder: "Descrição (opcional)" }, t.description || "");
  const date = el("input", { class: "form-control", type: "date", value: t.due_date || "" });
  const time = el("input", { class: "form-control", type: "time", value: t.due_time || "" });
  const prio = el("select", { class: "form-control" });
  [["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"]].forEach(([v, l]) => prio.append(el("option", { value: v, ...(v === (t.priority || "media") ? { selected: "" } : {}) }, l)));

  const segP = el("button", { type: "button", class: "seg-p" }, "🧑 Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "💼 Trabalho");
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
    if (area !== "pessoal") { cliSel.value = ""; fillProcs(); procSel.value = ""; } // zera vínculos ao virar pessoal
    area = "pessoal"; paint();
  };
  segT.onclick = () => { area = "profissional"; paint(); };
  paint();

  const cliSel = el("select", { class: "form-control" });
  cliSel.append(el("option", { value: "" }, "— nenhum —"));
  clients.forEach((c) => cliSel.append(el("option", { value: c.id, ...(t.client_id === c.id ? { selected: "" } : {}) }, c.nome)));
  const procSel = el("select", { class: "form-control" });
  const fillProcs = () => {
    const cid = cliSel.value; procSel.innerHTML = ""; procSel.append(el("option", { value: "" }, "— nenhum —"));
    processes.filter((p) => !cid || p.client_id === cid).forEach((p) => procSel.append(el("option", { value: p.id, ...(t.process_id === p.id ? { selected: "" } : {}) }, p.nome)));
  };
  cliSel.addEventListener("change", fillProcs);
  fillProcs();

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
      await update("tasks", t.id, {
        title: title.value.trim(), description: desc.value.trim(), area, priority: prio.value,
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
    ["Área", pessoal ? "🧑 Pessoal" : "💼 Trabalho"],
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
    ].filter(([, v]) => v);
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
      t.description ? el("div", { class: "detail-desc", style: "white-space:pre-wrap; margin-bottom:12px" }, t.description) : el("div", { class: "t2", style: "margin-bottom:12px" }, "Sem descrição. Toque em Editar para adicionar."),
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
    el("div", {}, [el("h1", { class: "page-title" }, "Agenda 🗓️"), el("p", { class: "page-sub" }, "Calendário e todos os compromissos")]),
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
      el("h1", { class: "page-title" }, "Lembretes 🔔"),
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
    el("div", {}, [el("h1", { class: "page-title" }, "Notas 📝"), el("p", { class: "page-sub" }, "Ideias, anotações e lembretes")]),
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
    el("div", { class: "t2", style: "margin-top:8px; opacity:.7" }, "🖊 toque para editar · " + prettyDate(n.created_at)),
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
      el("div", {}, [el("h1", { class: "page-title" }, "Clientes 👤"), el("p", { class: "page-sub" }, `${clients.length} cadastrado${clients.length === 1 ? "" : "s"}`)]),
      el("div", { style: "display:flex; gap:6px; flex-shrink:0" }, [
        el("button", { class: "btn btn-ghost btn-sm", onclick: openImportsManager, title: "Desfazer importações" }, "↩︎"),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => importInput.click() }, "⬆ Importar"),
      ]),
    ]),
    importInput, search, listWrap,
  );
  draw();
  addFab(() => openClientModal());
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
  let ok = 0, sem = 0;
  for (const row of ordenadas) {
    try {
      const { client } = matchClient(row, cols, clients, known);
      const base = buildProcessFromRow(row, cols, client);
      await insert("processes", { ...base, client_id: client ? client.id : null, status: "Ativo", andamentos: [] });
      if (client && base.num) known.push({ num: base.num, client_id: client.id });
      ok++; if (!client) sem++;
    } catch {}
  }
  toast(`✅ ${ok} processos importados${sem ? " · ⚠️ " + sem + " sem cliente identificado (abra e vincule)" : ""}.`, { duration: 9000 });
  renderClients();
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
  const meus = procs.filter((p) => p.client_id === id);
  // Só tarefas profissionais aparecem na pasta do cliente.
  // As pessoais vinculadas a um cliente são referência privada (ficam só no cadastro pessoal).
  const minhasTarefas = tasks.filter((t) => t.client_id === id && t.area === "profissional" && !t.done);

  const dados = [
    ["CPF", c.cpf], ["RG", c.rg], ["Telefone", c.tel], ["E-mail", c.email],
    ["Nascimento", c.nasc ? prettyDate(c.nasc) : ""], ["Endereço", c.endereco],
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

  const form = el("form", {}, [
    lbl("Nome *", nome), lbl("CPF", cpf), lbl("RG", rg), lbl("Telefone / WhatsApp", tel),
    lbl("E-mail", email), lbl("Nascimento", nasc), lbl("Endereço", endereco),
    lbl("Área", area), lbl("Origem", origem), lbl("Observações", obs),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) { nome.focus(); return; }
    const data = { nome: nome.value.trim(), cpf: cpf.value.trim(), rg: rg.value.trim(), tel: tel.value.trim(), email: email.value.trim(), nasc: nasc.value || null, endereco: endereco.value.trim(), area: area.value.trim(), origem: origem.value.trim(), obs: obs.value.trim() };
    if (existing) { await update("clients", existing.id, data); closeModal(); openClient(existing.id); }
    else { const saved = await insert("clients", data); closeModal(); if (saved) openClient(saved.id); else renderClients(); }
  };
  openModal(el("div", {}, [el("h3", {}, existing ? "Editar cliente" : "Novo cliente"), form]));
  setTimeout(() => nome.focus(), 50);
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
  main.append(
    el("div", {}, [el("h1", { class: "page-title" }, "Processos ⚖️"), el("p", { class: "page-sub" }, `${procs.length} cadastrado${procs.length === 1 ? "" : "s"}`)]),
    search, chips, listWrap,
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

  const linhas = [
    ["Número", p.num], ["Cliente", cliente ? cliente.nome : ""], ["Grau", p.grau === "2" ? "2º grau" : "1º grau"],
    ["Tipo de ação", p.tipo],
    ["Vara / Juízo", p.vara], ["Tribunal", p.tribunal], ["Partes contrárias", p.partes],
    ["Distribuição", p.data_distribuicao ? prettyDate(p.data_distribuicao) : ""],
    ["Fase atual", p.fase], ["Valor da causa", p.valor != null ? BRLnum(p.valor) : ""],
  ].filter(([, v]) => v);

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
    cliente ? el("div", { style: "text-align:center;margin-top:4px" }, [
      el("button", { class: "btn btn-ghost btn-sm", onclick: () => openClient(cliente.id) }, "Abrir pasta do cliente →"),
    ]) : null,
  );
  removeFab();
}

function openProcessModal(existing, fixedClientId, onDone, defaultGrau) {
  const f = existing || {};
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
