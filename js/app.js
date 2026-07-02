import { initSupabase, isCloud, list, insert, update, remove } from "./store.js";
import { getSession, signIn, signUp, signOut, enterLocal, onAuthChange } from "./auth.js";
import { $, $$, el, todayISO, prettyDate, openModal, closeModal, toast } from "./ui.js";
import { mountCapture } from "./capture.js";

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
  const routes = { dashboard: renderDashboard, clients: renderClients, processes: renderProcesses, personal: renderTasksPage, professional: renderTasksPage, reminders: renderReminders, notes: renderNotes };
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
    : { title: "Pessoal 🧑", sub: "Tarefas, metas e lembretes" };
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

function taskRow(t, compact = false) {
  const today = todayISO();
  const late = t.due_date && t.due_date < today && !t.done;
  const check = el("button", { class: "check" + (t.done ? " done" : ""), title: "Concluir" }, t.done ? "✓" : "");
  check.onclick = async () => { await update("tasks", t.id, { done: !t.done, done_at: !t.done ? new Date().toISOString() : null }); refresh(); };

  const meta = [];
  if (t.due_date) meta.push((late ? "⚠ atrasada · " : "") + prettyDate(t.due_date));
  const children = [
    check,
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, t.title),
      meta.length ? el("div", { class: "t2", style: late ? "color:var(--red)" : "" }, meta.join(" ")) : null,
    ]),
  ];
  if (!compact) {
    if (t.priority) children.push(el("span", { class: "pill " + t.priority }, t.priority));
    children.push(el("button", { class: "del", title: "Excluir", onclick: async () => { await remove("tasks", t.id); refresh(); } }, "×"));
  }
  return el("div", { class: "row" + (t.done ? " task-done" : "") }, children);
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
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, r.title || "Lembrete"),
      r.body ? el("div", { class: "t2", style: "white-space:pre-wrap; margin-top:2px" }, r.body) : null,
      r.remind_on
        ? el("div", { class: "t2", style: "margin-top:4px;" + (late ? "color:var(--red)" : "color:var(--accent)") }, "📅 " + prettyDate(r.remind_on) + (late ? " · atrasado" : ""))
        : null,
    ]),
  ];
  if (!compact) {
    children.push(el("button", { class: "del", title: "Excluir", onclick: async () => { await remove("reminders", r.id); renderReminders(); } }, "×"));
  }
  return el("div", { class: "row reminder-row" }, children);
}

function openReminderModal() {
  const title = el("input", { type: "text", placeholder: "Sobre o que é o lembrete?", required: "" });
  const body = el("textarea", { rows: "4", placeholder: "Detalhes importantes (opcional)…" });
  const date = el("input", { type: "date", value: todayISO() });

  const form = el("form", {}, [
    el("label", {}, ["Título", title]),
    el("label", {}, ["Data", date]),
    el("label", {}, ["Informações (opcional)", body]),
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", class: "btn btn-ghost", onclick: closeModal }, "Cancelar"),
      el("button", { type: "submit", class: "btn btn-primary" }, "Salvar"),
    ]),
  ]);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    await insert("reminders", { title: title.value.trim(), body: body.value.trim(), remind_on: date.value || null });
    closeModal(); renderReminders();
  };
  openModal(el("div", {}, [el("h3", {}, "Novo lembrete"), form]));
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
  return el("div", { class: "card", style: "padding:14px" }, [
    el("div", { class: "section-head" }, [
      el("div", { class: "t1", style: "font-weight:700" }, n.title || "Sem título"),
      el("button", { class: "del", onclick: async () => { await remove("notes", n.id); renderNotes(); } }, "×"),
    ]),
    n.body ? el("div", { class: "t2", style: "margin-top:6px; white-space:pre-wrap; line-height:1.5" }, n.body) : null,
    el("div", { class: "t2", style: "margin-top:8px; opacity:.7" }, prettyDate(n.created_at)),
  ]);
}

function openNoteModal() {
  const title = el("input", { type: "text", placeholder: "Título" });
  const body = el("textarea", { rows: "6", placeholder: "Escreva aqui…" });
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
    await insert("notes", { title: title.value.trim(), body: body.value.trim() });
    closeModal(); renderNotes();
  };
  openModal(el("div", {}, [el("h3", {}, "Nova nota"), form]));
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
  main.append(
    el("div", {}, [el("h1", { class: "page-title" }, "Clientes 👤"), el("p", { class: "page-sub" }, `${clients.length} cadastrado${clients.length === 1 ? "" : "s"}`)]),
    search, listWrap,
  );
  draw();
  addFab(() => openClientModal());
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

async function openClient(id) {
  loading();
  const [clients, procs] = await Promise.all([list("clients"), list("processes")]);
  const c = clients.find((x) => x.id === id);
  if (!c) { renderClients(); return; }
  const meus = procs.filter((p) => p.client_id === id);

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
    el("div", { class: "card" }, [
      el("div", { class: "section-head", style: "margin-bottom:10px" }, [
        el("div", { class: "card-title", style: "margin:0" }, `Processos (${meus.length})`),
        el("button", { class: "btn btn-primary btn-sm", onclick: () => openProcessModal(null, id) }, "＋ Novo"),
      ]),
      meus.length
        ? el("div", { class: "list" }, meus.map((p) => processCard(p, true)))
        : el("div", { class: "empty" }, "Nenhum processo para este cliente."),
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

function processCard(p, compact, clienteNome) {
  const meta = [];
  if (p.tipo) meta.push(el("span", { class: "tag" }, p.tipo));
  if (p.fase) meta.push(el("span", { class: "tag" }, "📍 " + p.fase));
  if (!compact && clienteNome) meta.push(el("span", { class: "tag" }, "👤 " + clienteNome));
  if (p.andamentos && p.andamentos.length) meta.push(el("span", { class: "tag" }, "🕓 " + p.andamentos.length));
  return el("div", { class: "row", style: "align-items:flex-start", onclick: () => openProcessModal(p) }, [
    el("div", { class: "grow" }, [
      el("div", { class: "t1" }, p.nome),
      p.num ? el("div", { class: "t2" }, "Nº " + p.num) : null,
      el("div", { class: "proc-meta" }, meta),
    ]),
    statusBadge(p.status),
  ]);
}

function openProcessModal(existing, fixedClientId) {
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
  const valor = inp("0,00", f.valor, { type: "number", step: "0.01", inputmode: "decimal" });
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
    lbl("Tipo de ação", tipo), lbl("Vara / Juízo", vara), lbl("Tribunal", tribunal),
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
      data_distribuicao: data.value || null, fase: fase.value, status: status.value,
      valor: valor.value ? parseFloat(valor.value) : null, obs: obs.value.trim(), andamentos: ands,
    };
    if (existing) await update("processes", existing.id, payload);
    else await insert("processes", payload);
    closeModal();
    if (fixedClientId) openClient(fixedClientId);
    else if (existing && state.route !== "processes") refresh();
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
