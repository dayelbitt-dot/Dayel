import { initSupabase, isCloud, list, insert, update, remove } from "./store.js";
import { getSession, signIn, signUp, signOut, enterLocal, onAuthChange } from "./auth.js";
import { $, $$, el, todayISO, prettyDate, openModal, closeModal } from "./ui.js";

let state = { route: "dashboard" };

// ==================== BOOTSTRAP ====================
async function boot() {
  if (isCloud()) await initSupabase();

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
  const routes = { dashboard: renderDashboard, personal: renderTasksPage, professional: renderTasksPage, notes: renderNotes };
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
  const [tasks, notes] = await Promise.all([
    list("tasks", { orderBy: "created_at", asc: true }),
    list("notes"),
  ]);

  const today = todayISO();
  const pending = tasks.filter((t) => !t.done);
  const dueToday = pending.filter((t) => t.due_date === today);
  const overdue = pending.filter((t) => t.due_date && t.due_date < today);
  const personalOpen = pending.filter((t) => (t.area || "pessoal") === "pessoal");
  const workOpen = pending.filter((t) => t.area === "profissional");

  const main = $("#main");
  main.innerHTML = "";
  main.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h1", { class: "page-title" }, saudacao()),
        el("p", { class: "page-sub" }, resumoLinha(pending.length, overdue.length)),
      ]),
    ]),
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

// ==================== HELPERS ====================
function stat(label, value, cls = "") {
  return el("div", { class: "stat" }, [
    el("div", { class: "label" }, label),
    el("div", { class: "value " + cls }, value),
  ]);
}
function refresh() { navigate(state.route); }

// ==================== SERVICE WORKER ====================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
