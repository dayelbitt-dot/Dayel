// Captura rápida multi-tipo: o usuário escreve/fala/sobe arquivos, ESCOLHE um ou
// mais destinos (Tarefa, Agenda, Nota, Cliente, Processo) e o sistema monta um
// cartão EDITÁVEL para cada um — já preenchido com o que conseguiu interpretar do
// texto e dos documentos. Ao gerar, cria todos de uma vez e, quando Cliente e
// Processo são escolhidos juntos, faz o cadastro completo dos dois e VINCULA
// automaticamente o processo ao cliente novo.

import { el, prettyDate, todayISO, toast } from "./ui.js";
import { parseNaturalTask, shortTitle, isLongText } from "./nlp.js";
import { extractTextFromFile } from "./files.js";
import { extractClient, extractClients, extractProcess, parseMoney } from "./extract.js";
import { aiEnabled, aiExtract } from "./ai.js";
import { list, insert, update, remove } from "./store.js";
import { assistEnabled, perguntar } from "./assist.js";
import * as gcal from "./gcal.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const normalize = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Destinos possíveis (multi-seleção). icoId = ícone de traço fino (sprite no index.html).
const TYPES = [
  { key: "tarefa", icoId: "i-check", label: "Tarefa" },
  { key: "agenda", icoId: "i-cal", label: "Agenda" },
  { key: "nota", icoId: "i-note", label: "Nota" },
  { key: "cliente", icoId: "i-users", label: "Cliente" },
  { key: "processo", icoId: "i-scale", label: "Processo" },
];
// Ordem de criação (cliente antes do processo, para poder vincular).
const ORDER = ["cliente", "processo", "tarefa", "agenda", "nota"];
// Rótulo do botão de cadastrar de cada cartão.
const CARD_ACTION = { cliente: "✓ Cadastrar cliente", processo: "✓ Gerar processo", tarefa: "✓ Criar tarefa", agenda: "✓ Adicionar à agenda", nota: "✓ Salvar nota" };

// ---------- anexos (arquivos embutidos como data URL) ----------
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

// Detecta cliente e processo JÁ CADASTRADOS a partir do texto livre.
function detectLinks(raw, clients, processes) {
  const t = normalize(raw);
  let client = null, process = null, cScore = 0, pScore = 0;
  for (const c of clients) {
    const parts = normalize(c.nome).split(/\s+/).filter((w) => w.length >= 3);
    let s = 0;
    for (const w of parts) if (t.includes(w)) s += w.length;
    if (s > cScore) { cScore = s; client = c; }
  }
  for (const p of processes) {
    const parts = normalize(p.nome).split(/[\s—-]+/).filter((w) => w.length >= 4);
    let s = 0;
    for (const w of parts) if (t.includes(w)) s += w.length;
    if (p.num && t.includes(normalize(p.num))) s += 12;
    if (client && p.client_id === client.id) s += 4;
    if (s > pScore) { pScore = s; process = p; }
  }
  if (cScore < 3) client = null;
  if (pScore < 4) process = null;
  if (process && !client && process.client_id) client = clients.find((c) => c.id === process.client_id) || null;
  if (client && !process) {
    const cp = processes.filter((p) => p.client_id === client.id);
    if (cp.length === 1) process = cp[0];
  }
  return { client, process };
}

// ============================================================
export function mountCapture(defaultArea, onDone = () => {}) {
  const selected = new Set(["tarefa"]);
  let typesTouched = false; // usuário mexeu manualmente nos destinos?
  let attachments = []; // {name,type,size,data,text}  (text = conteúdo lido, p/ preencher; não é salvo no registro)
  let cards = [];       // controladores dos cartões ({ key, node, collect })
  let sessionUndo = [];      // {table,id} ou {gcalId} criados nesta captura
  let sessionClientIds = []; // ids dos clientes já cadastrados nesta captura (p/ vincular o processo)
  let principal = null;      // botão principal do rodapé (definido em prepare)

  // Quando tudo já foi cadastrado, o botão principal vira "Concluir": ATIVO,
  // e ao tocar limpa a captura e volta ao Início (antes ele ficava desativado
  // como "✓ Concluído" e o toque não fazia nada).
  function toConcluir() {
    if (!principal) return;
    principal.disabled = false;
    principal.classList.add("btn-primary");
    principal.textContent = "✓ Concluir";
    principal.onclick = reset;
  }

  // Rascunho persistente: o que você escreve/dita e os destinos escolhidos ficam
  // salvos NESTE aparelho, então dá para sair, fechar o app e continuar de onde
  // parou. O texto/destinos vão numa chave e os anexos noutra (best-effort), para
  // um anexo grande nunca impedir de salvar o texto (limite do localStorage).
  const DRAFT_KEY = "assist:capture_draft";
  const FILES_KEY = "assist:capture_files";
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: textarea.value, types: [...selected] })); } catch {}
    try {
      if (attachments.length) localStorage.setItem(FILES_KEY, JSON.stringify(attachments));
      else localStorage.removeItem(FILES_KEY);
    } catch { /* sem espaço para os anexos: preserva ao menos o texto */ }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(FILES_KEY); } catch {} }

  const textarea = el("textarea", {
    class: "capture-input", rows: "2",
    placeholder: assistEnabled()
      ? "Escreva, pergunte ou dê uma ordem… ex.: “qual o prazo do Luciano?” · “crie tarefa contestar até sexta” · ou os dados do cliente/processo"
      : "Descreva ou cole aqui… ex: “Recurso de Agravo Simone amanhã 14h” — ou os dados do cliente/processo",
  });
  const status = el("div", { class: "capture-status" });

  // seletor de destinos
  const typesRow = el("div", { class: "cap-types" });
  const typeBtns = {};
  const paintTypes = () => TYPES.forEach((t) => typeBtns[t.key].classList.toggle("active", selected.has(t.key)));
  TYPES.forEach((t) => {
    const b = el("button", { type: "button", class: "cap-type", "data-k": t.key }, [svgIcon(t.icoId), t.label]);
    b.onclick = () => { typesTouched = true; selected.has(t.key) ? selected.delete(t.key) : selected.add(t.key); paintTypes(); saveDraft(); };
    typeBtns[t.key] = b;
    typesRow.append(b);
  });
  paintTypes();
  const typeHint = el("div", { class: "cap-typehint" }, "Escolha os destinos — ou anexe um documento e escreva a instrução (ex.: “cadastre o cliente” / “cadastre o processo”) que eu marco sozinho e puxo os dados do arquivo.");

  const micBtn = el("button", { type: "button", class: "cap-btn", title: "Gravar áudio" }, [svgIcon("i-mic"), "Falar"]);
  const fileBtn = el("button", { type: "button", class: "cap-btn", title: "Subir arquivos" }, [svgIcon("i-clip"), "Arquivos"]);
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,.xlsx,.xls,text/plain", multiple: "" });
  const prepBtn = el("button", { type: "button", class: "btn btn-primary cap-submit" }, "Preparar →");
  // Botão da IA: pergunta (consulta seus dados) OU ordem (a IA propõe e você confirma).
  const askBtn = assistEnabled()
    ? el("button", { type: "button", class: "btn btn-ghost cap-submit", title: "Perguntar ou dar uma ordem em linguagem natural (IA)" }, "🤖 Perguntar / Fazer")
    : null;

  const attWrap = el("div", { class: "att-list" });
  const cardsWrap = el("div", { class: "cap-cards hidden" });
  const aiPanel = el("div", { class: "cap-ai hidden" });

  const card = el("div", { class: "card capture" }, [
    el("div", { class: "capture-head" }, [svgIcon("i-spark"), el("span", {}, "Captura rápida")]),
    textarea,
    typesRow,
    typeHint,
    attWrap,
    status,
    el("div", { class: "capture-actions" }, [micBtn, fileBtn, el("span", { class: "grow" }), askBtn, prepBtn].filter(Boolean)),
    aiPanel,
    cardsWrap,
    fileInput,
  ]);
  if (askBtn) askBtn.onclick = () => askAI();

  // ---------- anexos: desenha os chips ----------
  const drawAtts = () => {
    attWrap.innerHTML = "";
    attachments.forEach((a, i) => attWrap.append(el("div", { class: "att-item" }, [
      el("span", { class: "att-ico" }, iconForType(a.type, a.name)),
      el("span", { class: "att-name grow", ...(a.data ? { onclick: () => openAttachment(a) } : {}) }, a.name),
      a.text ? el("span", { class: "att-read t2", title: "Conteúdo lido — será usado para preencher os cadastros" }, "✓ lido") : null,
      el("span", { class: "att-size t2" }, fmtBytes(a.size)),
      el("button", { type: "button", class: "del", title: "Remover", onclick: () => { attachments.splice(i, 1); drawAtts(); saveDraft(); } }, "×"),
    ])));
  };

  // Restaura o rascunho salvo (texto + destinos + anexos), se houver.
  (function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d) {
        if (typeof d.text === "string") textarea.value = d.text;
        if (Array.isArray(d.types) && d.types.length) { selected.clear(); d.types.forEach((k) => selected.add(k)); }
      }
      const f = JSON.parse(localStorage.getItem(FILES_KEY) || "null");
      if (Array.isArray(f) && f.length) attachments = f;
    } catch {}
    paintTypes();
    drawAtts();
    if (textarea.value.trim() || attachments.length) status.textContent = "↩️ Rascunho recuperado — continue de onde parou.";
  })();
  // Salva a cada tecla digitada (e colagem).
  textarea.addEventListener("input", saveDraft);

  // ---------- preparar ----------
  async function prepare() {
    const userText = textarea.value.trim();                                   // instrução digitada/ditada
    const docText = attachments.map((a) => a.text).filter(Boolean).join("\n\n"); // conteúdo dos documentos
    if (!userText && !docText && !attachments.length) { textarea.focus(); return; }

    status.textContent = "Analisando…";
    // Para as REGRAS (extract.js) tiramos a instrução do texto — senão o próprio
    // comando viraria nome/dado. Sobra só o que o usuário digitou como DADO + o doc.
    const dataText = stripCommand(userText);
    const combined = [dataText, docText].filter(Boolean).join("\n\n");
    const cmdCli = commandName(userText, "cliente");                          // nome dito na instrução, se houver

    // ---- IA lê o COMANDO + o documento e devolve o plano já interpretado ----
    // (destinos a criar, partes que são clientes e seus dados, processo). Se a IA
    // não estiver disponível, tudo cai nas regras abaixo — nada trava.
    let aiClientes = null, aiProc = null, aiDest = null, aiUsed = false;
    if (aiEnabled() && (userText || docText)) {
      status.textContent = docText ? "🤖 Lendo o comando e o documento com IA…" : "🤖 Interpretando o comando com IA…";
      try {
        const want = typesTouched ? [...selected] : null;                     // se o usuário marcou à mão, respeita; senão a IA decide
        const ai = await aiExtract(docText, want, userText);
        if (ai) { aiClientes = ai.clientes; aiProc = ai.processo; aiDest = ai.destinos; aiUsed = true; }
      } catch {}
    }

    // ---- Destinos: usuário à mão > IA interpretando o comando > regras (intentFromText) ----
    if (!typesTouched) {
      let intent = (aiDest && aiDest.length) ? new Set(aiDest.filter((k) => ORDER.includes(k))) : null;
      if (!intent || !intent.size) intent = intentFromText(userText);
      if (intent && intent.size) { selected.clear(); intent.forEach((k) => selected.add(k)); paintTypes(); }
    }
    if (!selected.size) { status.textContent = ""; toast("Escolha ao menos um destino (Tarefa, Agenda, Nota, Cliente ou Processo)."); return; }
    status.textContent = aiUsed ? "🤖 Comando interpretado pela IA." : "";

    let clients = [], processes = [];
    try { [clients, processes] = await Promise.all([list("clients", { orderBy: "nome", asc: true }), list("processes")]); } catch {}
    const det = detectLinks(combined, clients, processes);                    // detecta cliente/processo já cadastrados (inclui o doc)
    const parsed = parseNaturalTask(userText, defaultArea) || { title: userText, area: defaultArea, priority: "media", due_date: null, due_time: null };
    const exProc = mergeFields(aiProc, extractProcess(combined));

    // ---- Lista de CLIENTES a cadastrar (uma OU várias partes) ----
    const clientCmd = parseClientCommand(userText);      // { mode: one|all|named, names: [], side }
    let parties = [];
    if (selected.has("cliente")) {
      const ia = (aiUsed && Array.isArray(aiClientes)) ? aiClientes.filter((p) => p && (p.nome || p.cpf)) : [];
      if (ia.length) {
        // A IA já leu o comando e decidiu QUAIS e QUANTAS partes são clientes
        // (e de que lado). Confiamos nela — é exatamente o que o usuário pediu.
        parties = (clientCmd.mode === "named" && clientCmd.names.length)
          ? pickNamed(ia, clientCmd.names)
          : ia;
      } else {
        // Sem IA: cai nas regras. Ao indicar por NOME, procura em ambos os lados
        // (o cliente pode ser o réu).
        const side = clientCmd.mode === "named" ? "ambos" : clientCmd.side;
        const regras = extractClients(combined, side);
        if (clientCmd.mode === "one") {
          parties = [regras[0] || extractClient(combined) || {}];
          if (!parties[0].nome && cmdCli) parties[0] = { ...parties[0], nome: cmdCli };
        } else {
          parties = regras.slice();
          if (!parties.length) { const c = extractClient(combined); if (c.nome || c.cpf) parties = [c]; }
          if (clientCmd.mode === "named" && clientCmd.names.length) {
            parties = pickNamed(parties, clientCmd.names);
          }
        }
      }
      if (!parties.length) parties = [{}];   // ao menos um cartão vazio para preencher à mão
    }
    const partyNames = parties.map((p) => p.nome).filter(Boolean);

    cards = [];
    cardsWrap.innerHTML = "";
    sessionUndo = []; sessionClientIds = [];
    const bothCliProc = selected.has("cliente") && selected.has("processo");

    // Monta os controladores (um por cartão; várias partes = vários cartões de cliente).
    const ctrls = [];
    for (const key of ORDER) {
      if (!selected.has(key)) continue;
      if (key === "cliente") { parties.forEach((p, i) => ctrls.push(buildClientCard(p, null, aiUsed, parties.length > 1 ? i + 1 : 0))); continue; }
      if (key === "processo") ctrls.push(buildProcessCard(exProc, det, clients, bothCliProc, partyNames, aiUsed));
      else if (key === "tarefa") ctrls.push(buildTaskCard(parsed, det, clients, processes, userText));
      else if (key === "agenda") ctrls.push(buildAgendaCard(parsed, userText));
      else if (key === "nota") ctrls.push(buildNoteCard(parsed, userText));
    }
    cards = ctrls.filter(Boolean);

    // Com mais de um cartão, CADA cartão ganha seu próprio botão de cadastrar —
    // você autoriza cada um separadamente. Com um só, usa o botão de baixo.
    const multi = cards.length > 1;
    cards.forEach((ctrl) => {
      if (multi) {
        const btn = el("button", { type: "button", class: "btn btn-primary btn-block cap-cardbtn" }, CARD_ACTION[ctrl.key] || "✓ Cadastrar");
        btn.onclick = () => createOne(ctrl, btn);
        ctrl._btn = btn;
        ctrl.node.append(el("div", { class: "cap-cardfoot" }, [btn]));
      }
      cardsWrap.append(ctrl.node);
    });

    principal = el("button", { type: "button", class: "btn btn-primary btn-block" }, multi ? "✓ Cadastrar todos os pendentes" : (CARD_ACTION[cards[0] ? cards[0].key : ""] || "✓ Gerar"));
    const limpar = el("button", { type: "button", class: "btn btn-ghost btn-block" }, "Limpar");
    // Um só cartão: cadastra e já limpa (fluxo rápido de sempre). Vários: cada um
    // tem seu botão; este cadastra os que faltam. Se já estava tudo cadastrado
    // (o usuário usou os botões de cada cartão), o principal já é "Concluir".
    principal.onclick = async () => {
      if (cards.length && cards.every((c) => c.done)) { reset(); return; }
      if (multi) { await createAllPending(principal); }
      else if (cards[0] && await createOne(cards[0], principal)) { reset(); }
    };
    limpar.onclick = reset;
    cardsWrap.append(el("div", { class: "cap-gen" }, [limpar, principal]));

    // Se anexou documento mas ele não trouxe texto (escaneado/protegido) e os
    // cartões saíram vazios, avisa claramente — em vez de deixar o usuário na dúvida.
    const anexouSemTexto = attachments.length && !docText.trim();
    const cartoesVazios = !partyNames.length && !exProc.num && !exProc.tipo;
    status.textContent = (anexouSemTexto && cartoesVazios)
      ? "⚠️ Não consegui ler o conteúdo do documento anexado (pode estar escaneado ou protegido). Preencha os campos abaixo à mão."
      : "";
    cardsWrap.classList.remove("hidden");
    prepBtn.classList.add("hidden");
    const firstInput = cardsWrap.querySelector("input, textarea, select");
    if (firstInput) firstInput.focus();
  }
  prepBtn.addEventListener("click", prepare);
  // Ctrl/Cmd+Enter prepara — mas só quando os cartões ainda NÃO foram montados
  // (senão re-preparar apagaria as edições que o usuário fez nos cartões).
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && cardsWrap.classList.contains("hidden")) { e.preventDefault(); prepare(); }
  });

  // ---------- gerar (cria tudo e vincula) ----------
  // Remove tudo que já foi criado nesta captura (usado no rollback de falha
  // parcial e no botão "Desfazer"). Entradas: {table,id} ou {gcalId}.
  async function undoAll(undo) {
    for (const u of undo) {
      try {
        if (u.gcalId) await gcal.deleteEvent(u.gcalId);
        else await remove(u.table, u.id);
      } catch {}
    }
  }

  // Marca um cartão como já cadastrado (trava os campos e o botão).
  function markDone(ctrl, btn) {
    ctrl.done = true;
    ctrl.node.classList.add("cap-card-done");
    ctrl.node.querySelectorAll("input, textarea, select").forEach((x) => { x.disabled = true; });
    if (btn) { btn.disabled = true; btn.classList.remove("btn-primary"); btn.textContent = "✓ Cadastrado"; }
  }

  // Cadastra UM cartão (autorização individual). O processo é vinculado a todos
  // os clientes já cadastrados nesta captura (sessionClientIds).
  async function createOne(ctrl, btn) {
    if (!ctrl || ctrl.done) return true;
    const err = ctrl.validate && ctrl.validate(); if (err) { toast(err.msg); err.focus && err.focus(); return false; }
    const prev = btn ? btn.textContent : ""; if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
    const savable = attachments.filter((a) => a.data).map(({ text, ...a }) => a);
    try {
      let label = "", entry = null;
      if (ctrl.key === "cliente") {
        const data = { ...ctrl.collect(), attachments: savable };
        const saved = await insert("clients", data);
        if (saved) { entry = { table: "clients", id: saved.id }; sessionClientIds.push(saved.id); }
        label = "👤 " + data.nome;
      } else if (ctrl.key === "processo") {
        const data = { ...ctrl.collect(), attachments: savable };
        const ids = [...sessionClientIds];
        if (data.client_id && !ids.includes(data.client_id)) ids.push(data.client_id);
        data.client_ids = ids; data.client_id = ids[0] || null;
        const saved = await insert("processes", data);
        if (saved) entry = { table: "processes", id: saved.id };
        label = "⚖️ " + data.nome + (ids.length ? ` (vinculado a ${ids.length})` : "");
      } else if (ctrl.key === "tarefa") {
        const data = { ...ctrl.collect(), attachments: savable };
        const saved = await insert("tasks", data);
        if (saved) entry = { table: "tasks", id: saved.id };
        label = taskLabel("✅ Tarefa", data);
      } else if (ctrl.key === "agenda") {
        const { task, gcalWanted } = ctrl.collect();
        const saved = await insert("tasks", { ...task, attachments: savable });
        if (saved) entry = { table: "tasks", id: saved.id };
        label = taskLabel("🗓️ Agenda", task);
        if (gcalWanted) { try { const ev = await gcal.createEvent({ title: task.title, date: task.due_date, time: task.due_time, description: task.description }); if (ev && ev.id) sessionUndo.push({ gcalId: ev.id }); } catch (e) { toast("Salvo aqui, mas falhou no Google: " + (e.message || "")); } }
      } else if (ctrl.key === "nota") {
        const data = { ...ctrl.collect(), attachments: savable };
        const saved = await insert("notes", data);
        if (saved) entry = { table: "notes", id: saved.id };
        label = "📝 Nota";
      }
      if (entry) sessionUndo.push(entry);
      markDone(ctrl, btn);
      // NÃO re-renderiza aqui (isso recriaria a captura e apagaria os outros
      // cartões ainda pendentes). O Início é atualizado ao Limpar/concluir.
      toast("✅ " + label, { action: entry ? { label: "Desfazer", onClick: async () => { await undoAll([entry]); onDone(); toast("Cadastro desfeito."); } } : null });
      if (cards.every((c) => c.done)) { toast("Tudo cadastrado. ✅"); if (cards.length > 1) toConcluir(); }
      return true;
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = prev; }
      toast("Não consegui salvar: " + (e?.message || e));
      return false;
    }
  }

  // Cadastra todos os cartões pendentes (na ordem — clientes antes do processo).
  async function createAllPending(btn) {
    for (const c of cards) { if (c.done) continue; const err = c.validate && c.validate(); if (err) { toast(err.msg); err.focus && err.focus(); return; } }
    btn.disabled = true; btn.textContent = "Salvando…";
    for (const c of cards) { if (!c.done) { const ok = await createOne(c, c._btn); if (!ok) { btn.disabled = false; btn.textContent = "✓ Cadastrar todos os pendentes"; return; } } }
    toConcluir();   // tudo cadastrado → botão ATIVO "Concluir" (toque limpa e volta ao Início)
  }

  function reset() {
    const criou = sessionUndo.length > 0;
    textarea.value = ""; attachments = []; cards = []; sessionUndo = []; sessionClientIds = [];
    clearDraft();
    drawAtts();
    cardsWrap.innerHTML = ""; cardsWrap.classList.add("hidden");
    prepBtn.classList.remove("hidden"); status.textContent = "";
    if (criou) onDone(); // atualiza o Início só depois de sair da captura
  }

  // ---------- áudio ----------
  let rec = null;
  if (!SR) { micBtn.disabled = true; micBtn.title = "Seu navegador não suporta gravação de voz"; }
  else micBtn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
    let base = textarea.value ? textarea.value.trim() + " " : "";
    micBtn.classList.add("recording"); micBtn.innerHTML = ""; micBtn.append(svgIcon("i-mic"), "Ouvindo…");
    status.textContent = "🎙️ Fale agora… (toque de novo para parar)";
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += tr + " "; else interim += tr;
      }
      if (final) base += final;
      textarea.value = (base + interim).replace(/\s+/g, " ").trimStart();
      saveDraft();
    };
    const stop = () => { rec = null; micBtn.classList.remove("recording"); micBtn.innerHTML = ""; micBtn.append(svgIcon("i-mic"), "Falar"); status.textContent = ""; };
    rec.onend = stop;
    rec.onerror = (ev) => { stop(); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("Permita o acesso ao microfone para gravar."); };
    rec.start();
  });

  // ---------- arquivos: o arquivo FICA ANEXADO; o texto é lido e guardado JUNTO
  // do anexo (não é despejado na caixa) para preencher os cadastros ao Preparar.
  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files]; fileInput.value = "";
    for (const file of files) {
      status.textContent = `📄 Lendo “${file.name}”…`;
      let text = "";
      try { text = (await extractTextFromFile(file, (msg) => { status.textContent = msg; }) || "").trim(); } catch {}
      // data URL para guardar o arquivo (se couber no limite; senão fica só o texto lido)
      let data = null;
      if (file.size <= MAX_ANEXO) { try { data = await readFileAsDataURL(file); } catch {} }
      attachments.push({ name: file.name, type: file.type || "", size: file.size, data, text });
      drawAtts();
      if (file.size > MAX_ANEXO) status.textContent = `⚠️ “${file.name}” (${fmtBytes(file.size)}) é grande demais para guardar, mas li o conteúdo para preencher os cadastros.`;
      else if (text) status.textContent = `📎 “${file.name}” anexado. Escreva a instrução (ex.: “cadastre o cliente/processo”) e toque em Preparar — vou puxar os dados do arquivo.`;
      else {
        const doc = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name) || /^(image|application\/pdf)/.test(file.type || "");
        status.textContent = doc
          ? `📎 “${file.name}” anexado, mas não consegui LER o conteúdo (pode estar protegido, muito borrado ou ser um documento escaneado difícil). Você pode preencher os campos à mão depois de tocar em Preparar.`
          : `📎 “${file.name}” anexado.`;
      }
      saveDraft();
    }
  });

  // ================= ASSISTENTE POR IA (pergunta ou ordem) =================
  // Monta um retrato enxuto dos dados (com IDs) para a IA consultar e/ou agir.
  async function buildSnapshot() {
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

  // Executa UMA ação proposta pela IA e devolve como desfazê-la.
  async function executarAcao(a) {
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
      case "excluir": {
        if (!a.alvo_tabela || !a.alvo_id) throw new Error("sem alvo");
        const rows = await list(a.alvo_tabela);
        const old = rows.find((x) => x.id === a.alvo_id);
        await remove(a.alvo_tabela, a.alvo_id);
        return { undo: async () => { if (old) { const { id, user_id, created_at, ...rest } = old; await insert(a.alvo_tabela, rest); } } };
      }
      default:
        throw new Error("ação não suportada: " + a.tipo);
    }
  }

  let aiBusy = false;
  async function askAI() {
    const q = textarea.value.trim();
    // Conteúdo dos arquivos anexados (planilha, PDF, foto…) já lido.
    const docs = attachments.map((a) => (a.text && a.text.trim()) ? `📎 ${a.name}:\n${a.text.trim()}` : "").filter(Boolean).join("\n\n----\n\n");
    if (!q && !docs) { textarea.focus(); return; }
    if (aiBusy) return;
    aiBusy = true;
    aiPanel.classList.remove("hidden");
    aiPanel.innerHTML = "";
    aiPanel.append(el("div", { class: "cap-ai-msg" }, "🤖 Pensando…"));

    let r;
    try {
      const snapshot = await buildSnapshot();
      if (docs) snapshot.documentoAnexado = docs.slice(0, 70000);
      // Se houver anexo sem instrução, assume o pedido padrão.
      r = await perguntar(q || "Use o documento anexado para cumprir o que ele indica.", snapshot);
    } catch (e) { r = { error: e?.message || "falha" }; }
    aiBusy = false;
    aiPanel.innerHTML = "";

    if (r.error) {
      const msg = r.error === "nao_instalada"
        ? "A IA ainda não foi ativada no servidor. Veja o passo a passo no README (função “assistente”)."
        : r.error === "offline"
        ? "Este recurso precisa da nuvem (Supabase) configurada."
        : "Não consegui falar com a IA agora: " + r.error;
      aiPanel.append(el("div", { class: "cap-ai-msg err" }, "⚠️ " + msg));
      return;
    }

    if (r.resposta) aiPanel.append(el("div", { class: "cap-ai-msg" }, r.resposta));

    if (r.acoes && r.acoes.length) {
      const itens = el("ul", { class: "cap-ai-acts" }, r.acoes.map((a) => el("li", {}, a.resumo || a.tipo)));
      const confirmar = el("button", { type: "button", class: "btn btn-primary btn-sm" }, `✓ Confirmar (${r.acoes.length})`);
      const cancelar = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "Cancelar");
      aiPanel.append(el("div", { class: "cap-ai-confirm" }, [
        el("div", { class: "cap-ai-lbl" }, "Vou fazer o seguinte — confirma?"),
        itens,
        el("div", { class: "cap-ai-btns" }, [cancelar, confirmar]),
      ]));
      cancelar.onclick = () => { aiPanel.classList.add("hidden"); aiPanel.innerHTML = ""; };
      confirmar.onclick = async () => {
        confirmar.disabled = true; cancelar.disabled = true; confirmar.textContent = "Executando…";
        const undos = []; let ok = 0, fail = 0;
        for (const a of r.acoes) {
          try { const u = await executarAcao(a); if (u) undos.push(u); ok++; }
          catch { fail++; }
        }
        aiPanel.classList.add("hidden"); aiPanel.innerHTML = "";
        textarea.value = ""; clearDraft();
        onDone();
        toast(`✅ ${ok} açã${ok === 1 ? "o" : "ões"} feita${ok === 1 ? "" : "s"}${fail ? ` · ⚠️ ${fail} falhou` : ""}.`, {
          action: undos.length ? { label: "Desfazer", onClick: async () => { for (const u of undos.reverse()) { try { await u.undo(); } catch {} } onDone(); toast("Desfeito."); } } : null,
          duration: 9000,
        });
      };
    } else if (!r.resposta) {
      aiPanel.append(el("div", { class: "cap-ai-msg" }, "Não entendi o que fazer. Tente reformular."));
    }
  }

  return card;
}

// ============================================================
//  CARTÕES POR TIPO
// ============================================================

// Mescla os campos: a IA (quando veio) tem prioridade; as regras preenchem o
// que a IA deixou em branco. Assim nunca fica pior que só as regras.
function mergeFields(ai, heur) {
  const out = { ...heur };
  if (ai) for (const [k, v] of Object.entries(ai)) if (v != null && v !== "") out[k] = v;
  return out;
}

function cardShell(icoId, title, autofilled, children) {
  const head = el("div", { class: "cap-card-head" }, [svgIcon(icoId), el("span", {}, title)]);
  // autofilled: 'ai' → preenchido pela IA · true → preenchido pelas regras
  if (autofilled === "ai") head.append(el("span", { class: "cap-autofill" }, "preenchido pela IA"));
  else if (autofilled) head.append(el("span", { class: "cap-autofill" }, "preenchido automaticamente"));
  return el("div", { class: "cap-card" }, [head, ...children]);
}
function hasAny(obj, keys) { return keys.some((k) => obj[k] != null && obj[k] !== "" && obj[k] !== "1"); }

// ---------- CLIENTE ----------
function buildClientCard(ex, cmdName, aiUsed, idx) {
  ex = ex || {};
  const auto = aiUsed ? "ai" : (!!cmdName || hasAny(ex, ["nome", "cpf", "rg", "tel", "email", "nasc", "endereco", "area", "origem", "obs"]));
  // Nome dito na instrução ("cadastre o cliente Fulano") tem prioridade; o resto
  // (CPF, RG, endereço…) vem do documento anexado.
  const nome = inp("Nome completo *", cmdName || ex.nome, { required: "" });
  const cpf = inp("000.000.000-00 (ou CNPJ)", ex.cpf);
  const rg = inp("RG", ex.rg);
  const tel = inp("(51) 9 0000-0000", ex.tel);
  const email = inp("email@exemplo.com", ex.email, { type: "email" });
  const nasc = inp("", ex.nasc, { type: "date" });
  const endereco = inp("Rua, nº, bairro, cidade — UF", ex.endereco);
  const nacionalidade = inp("brasileira / brasileiro", ex.nacionalidade);
  const estadoCivil = inp("Ex: casada, solteiro…", ex.estado_civil);
  const profissao = inp("Ex: professora, empresário…", ex.profissao);
  const area = inp("Ex: Família, Cível…", ex.area);
  const origem = inp("Ex: Indicação, Instagram…", ex.origem);
  const obs = txt("Resumo do caso, histórico…", ex.obs, 2);

  const node = cardShell("i-users", idx ? `Novo cliente ${idx}` : "Novo cliente", auto, [
    field("Nome *", nome),
    el("div", { class: "cap-row" }, [field("CPF / CNPJ", cpf), field("RG", rg)]),
    el("div", { class: "cap-row" }, [field("Telefone / WhatsApp", tel), field("Nascimento", nasc)]),
    field("E-mail", email),
    field("Endereço", endereco),
    el("div", { class: "cap-row" }, [field("Nacionalidade", nacionalidade), field("Estado civil", estadoCivil), field("Profissão", profissao)]),
    el("div", { class: "cap-row" }, [field("Área", area), field("Origem", origem)]),
    field("Observações", obs),
  ]);
  return {
    key: "cliente", node,
    validate: () => (!nome.value.trim() ? { msg: "Informe o nome do cliente.", focus: () => nome.focus() } : null),
    collect: () => ({ nome: nome.value.trim(), cpf: cpf.value.trim(), rg: rg.value.trim(), tel: tel.value.trim(), email: email.value.trim(), nasc: nasc.value || null, endereco: endereco.value.trim(), nacionalidade: nacionalidade.value.trim(), estado_civil: estadoCivil.value.trim(), profissao: profissao.value.trim(), area: area.value.trim(), origem: origem.value.trim(), obs: obs.value.trim() }),
  };
}

// ---------- PROCESSO ----------
function buildProcessCard(ex, det, clients, linkedToNewClient, partyNames, aiUsed) {
  partyNames = (partyNames || []).filter(Boolean);
  const auto = aiUsed ? "ai" : (hasAny(ex, ["num", "tipo", "vara", "tribunal", "partes", "data_distribuicao", "fase", "valor"]) || ex.grau === "2");
  const num = inp("0000000-00.0000.8.21.0000", ex.num);
  // Nome sugerido: "Tipo — Clientes". Quando o Cliente também está sendo criado,
  // usa os nomes das partes novas; senão, o cliente detectado; por fim, a parte
  // contrária (para nunca ficar vazio).
  const linkedName = linkedToNewClient ? partyNames.slice(0, 2).join(" e ") : (det.client ? det.client.nome : "");
  const nomeSug = ex.nome || [ex.tipo, linkedName || ex.partes].filter(Boolean).join(" — ");
  const nome = inp("Ex: Revisão de Alimentos — João Silva", nomeSug, { required: "" });
  const tipo = inp("Ex: Alimentos, Cobrança…", ex.tipo);
  const vara = inp("Ex: 1ª Vara de Família — Venâncio Aires", ex.vara);
  const tribunal = inp("Ex: TJRS, 1ª Instância…", ex.tribunal);
  const partes = inp("Parte contrária, advogado…", ex.partes);
  const data = inp("", ex.data_distribuicao, { type: "date" });
  const fase = inp("Ex: Petição inicial, Sentença…", ex.fase);
  const status = sel([["Ativo", "Ativo"], ["Suspenso", "Suspenso"], ["Encerrado", "Encerrado"]], "Ativo");
  const grau = sel([["1", "1º grau"], ["2", "2º grau"]], ex.grau || "1");
  const valor = inp("Ex: 15000 ou 15.000,00", ex.valor != null ? String(ex.valor) : "", { inputmode: "decimal" });
  const obs = txt("Histórico, estratégia…", ex.obs, 2);

  // vínculo do cliente: se Cliente também foi escolhido, vincula ao novo; senão,
  // deixa escolher um cliente já cadastrado (pré-seleciona o detectado).
  let cliSel = null, linkNote = null;
  const children = [
    field("Número do processo", num),
    field("Nome / Descrição *", nome),
  ];
  if (linkedToNewClient) {
    const quem = partyNames.length > 1 ? `aos ${partyNames.length} clientes novos (${partyNames.join(", ")})` : "ao cliente novo (cartão acima)";
    linkNote = el("div", { class: "cap-linknote" }, "🔗 Será vinculado automaticamente " + quem + ".");
    children.push(linkNote);
  } else {
    cliSel = el("select", { class: "form-control" });
    cliSel.append(el("option", { value: "" }, "— nenhum cliente —"));
    clients.forEach((c) => cliSel.append(el("option", { value: c.id, ...(det.client && det.client.id === c.id ? { selected: "" } : {}) }, c.nome)));
    // "cadastre o processo": vincula sozinho ao cliente já cadastrado detectado.
    if (det.client) children.push(el("div", { class: "cap-linknote" }, "🔗 Vinculado automaticamente ao cliente “" + det.client.nome + "” (detectado). Troque abaixo se quiser."));
    children.push(field("Cliente", cliSel));
  }
  children.push(
    el("div", { class: "cap-row" }, [field("Tipo de ação", tipo), field("Grau", grau)]),
    field("Vara / Juízo", vara),
    el("div", { class: "cap-row" }, [field("Tribunal", tribunal), field("Fase atual", fase)]),
    field("Partes contrárias", partes),
    el("div", { class: "cap-row" }, [field("Distribuição", data), field("Status", status), field("Valor (R$)", valor)]),
    field("Observações / Estratégia", obs),
  );

  const node = cardShell("i-scale", "Novo processo", auto, children);
  return {
    key: "processo", node,
    validate: () => (!nome.value.trim() ? { msg: "Dê um nome/descrição ao processo.", focus: () => nome.focus() } : null),
    collect: () => ({
      num: num.value.trim(), nome: nome.value.trim(),
      client_id: cliSel ? (cliSel.value || null) : null,
      tipo: tipo.value.trim(), vara: vara.value.trim(), tribunal: tribunal.value.trim(),
      partes: partes.value.trim() || null, data_distribuicao: data.value || null, fase: fase.value.trim(),
      status: status.value, grau: grau.value, valor: parseMoney(valor.value), obs: obs.value.trim(), andamentos: [],
    }),
  };
}

// ---------- TAREFA ----------
function buildTaskCard(p, det, clients, processes, raw) {
  const linkedArea = det.client || det.process ? "profissional" : p.area;
  let area = linkedArea;
  const longo = isLongText(raw);
  const title = inp("Título", longo ? shortTitle(p.title || raw) : (p.title || ""), { required: "" });
  const desc = txt("Descrição (opcional)", longo ? raw.trim() : "", longo ? 3 : 2);
  const date = inp("", p.due_date || "", { type: "date" });
  const time = inp("", p.due_time || "", { type: "time" });
  const prio = sel([["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"]], p.priority || "media");

  const segP = el("button", { type: "button", class: "seg-p" }, "Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "Trabalho");
  const seg = el("div", { class: "seg" }, [segP, segT]);
  const cliSel = el("select", { class: "form-control" });
  cliSel.append(el("option", { value: "" }, "— nenhum —"));
  clients.forEach((c) => cliSel.append(el("option", { value: c.id, ...(det.client && det.client.id === c.id ? { selected: "" } : {}) }, c.nome)));
  const procSel = el("select", { class: "form-control" });
  const procInfo = el("div", { class: "cap-procinfo" });
  // Mostra nº/vara/fase do processo selecionado, para conferir que é o caso
  // certo (evita vincular a tarefa ao processo errado quando há nomes parecidos).
  const showProcInfo = () => {
    const p2 = procSel.value ? processes.find((x) => x.id === procSel.value) : null;
    procInfo.innerHTML = "";
    if (p2) {
      const bits = [p2.num ? "Nº " + p2.num : "", p2.vara || "", p2.fase || ""].filter(Boolean);
      if (bits.length) procInfo.append(el("div", { class: "t2" }, "⚖️ " + bits.join(" · ")));
    }
  };
  const fillProcs = () => {
    const cid = cliSel.value, atual = procSel.value;
    procSel.innerHTML = "";
    procSel.append(el("option", { value: "" }, "— nenhum —"));
    const avail = processes.filter((p2) => !cid || p2.client_id === cid);
    avail.forEach((p2) => procSel.append(el("option", { value: p2.id }, p2.nome)));
    procSel.value = avail.some((p2) => p2.id === atual) ? atual : "";
    showProcInfo();
  };
  // Rótulos dinâmicos: na área Pessoal, deixa claro que o vínculo é privado
  // (só para seu controle) e NÃO aparece na pasta do cliente.
  const cliLabel = el("span"), procLabel = el("span");
  const cliHint = el("div", { class: "t2", style: "margin-top:-4px" });
  const updateLabels = () => {
    const pessoal = area === "pessoal";
    cliLabel.textContent = pessoal ? "Vincular a um cliente (opcional, só seu)" : "Cliente (opcional)";
    procLabel.textContent = pessoal ? "Processo (opcional, só seu)" : "Processo (opcional)";
    cliHint.textContent = pessoal ? "Vínculo só para seu controle — NÃO aparece na pasta do cliente." : "";
    cliHint.style.display = pessoal ? "block" : "none";
  };
  const paintSeg = () => { segP.classList.toggle("active", area === "pessoal"); segT.classList.toggle("active", area === "profissional"); updateLabels(); };
  segP.onclick = () => { cliSel.value = ""; procSel.value = ""; fillProcs(); area = "pessoal"; paintSeg(); };
  segT.onclick = () => { area = "profissional"; paintSeg(); };
  cliSel.addEventListener("change", fillProcs);
  procSel.addEventListener("change", showProcInfo);
  paintSeg(); fillProcs();
  if (det.process && area === "profissional" && processes.some((p2) => p2.id === det.process.id)) { procSel.value = det.process.id; showProcInfo(); }

  const node = cardShell("i-check", "Nova tarefa", false, [
    field("Título *", title),
    field("Descrição", desc),
    field("Área", seg),
    el("div", { class: "cap-row" }, [field("Data", date), field("Hora", time), field("Prioridade", prio)]),
    field(cliLabel, cliSel),
    cliHint,
    field(procLabel, procSel),
    procInfo,
  ]);
  return {
    key: "tarefa", node,
    validate: () => (!title.value.trim() ? { msg: "Dê um título à tarefa.", focus: () => title.focus() } : null),
    collect: () => ({ title: title.value.trim(), description: desc.value.trim(), area, priority: prio.value, due_date: date.value || null, due_time: time.value || null, client_id: cliSel.value || null, process_id: procSel.value || null, done: false }),
  };
}

// ---------- AGENDA (evento = tarefa com data, opcionalmente no Google) ----------
function buildAgendaCard(p, raw) {
  let area = p.area || "pessoal";
  const title = inp("O que é?", p.title || "", { required: "" });
  const date = inp("", p.due_date || todayISO(), { type: "date" });
  const time = inp("", p.due_time || "", { type: "time" });
  const desc = txt("Detalhes (opcional)…", isLongText(raw) ? raw.trim() : "", 2);
  const segP = el("button", { type: "button", class: "seg-p" }, "Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "Trabalho");
  const seg = el("div", { class: "seg" }, [segP, segT]);
  const paintSeg = () => { segP.classList.toggle("active", area === "pessoal"); segT.classList.toggle("active", area === "profissional"); };
  segP.onclick = () => { area = "pessoal"; paintSeg(); };
  segT.onclick = () => { area = "profissional"; paintSeg(); };
  paintSeg();

  const gChk = el("input", { type: "checkbox" });
  const gRow = gcal.isConnected() ? el("label", { class: "cap-field", style: "flex-direction:row; align-items:center; gap:8px" }, [gChk, el("span", {}, "Criar também no Google Agenda")]) : null;

  const node = cardShell("i-cal", "Novo compromisso", !!(p.due_date || p.due_time), [
    field("O que é? *", title),
    el("div", { class: "cap-row" }, [field("Data", date), field("Hora", time)]),
    field("Área", seg),
    field("Detalhes", desc),
    gRow,
  ].filter(Boolean));
  return {
    key: "agenda", node,
    validate: () => (!title.value.trim() ? { msg: "Diga o que é o compromisso.", focus: () => title.focus() } : null),
    collect: () => ({
      task: { title: title.value.trim(), description: desc.value.trim(), area, priority: "media", due_date: date.value || todayISO(), due_time: time.value || null, done: false },
      gcalWanted: !!(gRow && gChk.checked),
    }),
  };
}

// ---------- NOTA ----------
function buildNoteCard(p, raw) {
  const longo = isLongText(raw);
  const title = inp("Título", longo ? shortTitle(p.title || raw) : (p.title || raw || ""));
  const body = txt("Escreva aqui…", longo ? raw.trim() : "", 4);
  const node = cardShell("i-note", "Nova nota", false, [field("Título", title), field("Conteúdo", body)]);
  return {
    key: "nota", node,
    validate: () => ((!title.value.trim() && !body.value.trim()) ? { msg: "Escreva algo na nota.", focus: () => title.focus() } : null),
    collect: () => ({ title: title.value.trim(), body: body.value.trim() }),
  };
}

// ============================================================
//  helpers de UI
// ============================================================
function field(label, control) { return el("label", { class: "cap-field" }, [label, control]); }
function icon(emoji) { return el("span", { class: "cap-ico" }, emoji); }
// Ícone de traço fino (referencia o sprite SVG do index.html).
function svgIcon(id, cls = "cap-svg") {
  const span = el("span", { class: cls });
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  return span;
}
function inp(ph, val, attrs = {}) { return el("input", { class: "form-control", placeholder: ph, value: val ?? "", ...attrs }); }
function txt(ph, val, rows = 2) { return el("textarea", { class: "form-control", rows: String(rows), placeholder: ph }, val || ""); }
function sel(opts, val) { const s = el("select", { class: "form-control" }); opts.forEach(([v, l]) => s.append(el("option", { value: v, ...(v === val ? { selected: "" } : {}) }, l))); return s; }
// Rótulo do aviso para tarefa/agenda: ecoa a data/hora entendida (ajuda a
// conferir na hora se a interpretação de linguagem natural acertou o prazo).
function taskLabel(base, t) {
  return t.due_date ? base + " · 📅 " + prettyDate(t.due_date) + (t.due_time ? " " + t.due_time : "") : base;
}
function openAttachment(a) {
  try { const link = el("a", { href: a.data, download: a.name || "arquivo" }); document.body.append(link); link.click(); link.remove(); }
  catch { toast("Não foi possível abrir o anexo."); }
}

// Deduz os destinos a partir da instrução digitada ("cadastre o cliente",
// "cadastre o processo", "criar nota", "agendar reunião"…). Vazio = mantém a
// seleção atual dos chips.
function intentFromText(text) {
  const t = normalize(text);
  const set = new Set();
  const cadastro = /\b(cadastr\w*|registr\w*|criar?|cria\w*|adicion\w*|inserir?|gerar?|abrir?|lan[cç]ar?)\b/.test(t);
  if (cadastro && (/\bclientes?\b/.test(t) || /\bpartes?\b/.test(t) || /\brequerentes?\b/.test(t) || /\bautor(?:es|a|as)?\b/.test(t) || /\bherdeir/.test(t) || /\bs[óo]cios?\b/.test(t))) set.add("cliente");
  if (cadastro && (/\bprocessos?\b/.test(t) || /\bpeti[cç][aã]o\b|\bpeticao\b|\bpeticoes\b/.test(t) || /\ba[cç][aã]o\s+judicial\b/.test(t) || /\bautos\b/.test(t))) set.add("processo");
  if (/\b(criar?|nova?|anotar?)\b.*\bnotas?\b|\bnotas?\b.*\b(criar?|nova?)\b|\banota[çc]\w*/.test(t)) set.add("nota");
  if (/\bagend\w*|\bcompromisso|\breuni\w*|\baudi[êe]nc\w*|\bevento/.test(t)) set.add("agenda");
  return set;
}

// Nome dito logo após "cliente/processo" na instrução ("cadastre o cliente João
// da Silva" → "João Da Silva"). Ignora placeholders (fulano…) e palavras que se
// referem ao documento (petição, anexo…), deixando o nome vir do arquivo.
function commandName(text, kind) {
  if (!text) return "";
  const re = new RegExp("\\b" + kind + "s?\\s*:?\\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\\-]*(?:\\s+[A-Za-zÀ-ÿ'.\\-]+){0,5})", "i");
  const m = text.match(re);
  if (!m) return "";
  let name = m[1].replace(/^(?:chamad[oa]\s+|de\s+nome\s+|sr[a]?\.?\s+|dr[a]?\.?\s+|d[aeo]s?\s+|para\s+|pra\s+|sobre\s+|nov[oa]\s+|um[a]?\s+|[oa]\s+)/i, "").trim();
  // corta em palavra que introduz outra ideia (nome de pessoa não tem "com/que/…")
  const CLAUSE = new Set(["com", "usando", "conforme", "segundo", "cujo", "cuja", "que", "pelo", "pela", "atraves", "e", "dados", "informacoes", "cpf", "rg", "referente"]);
  const parts = [];
  for (const w of name.split(/\s+/)) { if (CLAUSE.has(normalize(w))) break; parts.push(w); }
  name = parts.join(" ");
  const first = normalize(parts[0] || "");
  const bloq = new Set(["fulano", "beltrano", "sicrano", "ciclano", "peticao", "anexa", "anexo", "anexos", "documento", "documentos", "doc", "arquivo", "arquivos", "acima", "abaixo", "cliente", "processo"]);
  if (!name || bloq.has(first)) return "";
  return name.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Remove a INSTRUÇÃO do texto ("cadastre o cliente", "cadastrar todas as partes
// desse documento"…), deixando só o que o usuário digitou como DADO (um nome, por
// ex.). Assim o comando nunca é confundido com o conteúdo a cadastrar.
function stripCommand(text) {
  if (!text) return "";
  const re = /^\s*(?:por\s+favor,?\s*)?(?:cadastr\w+|registr\w+|criar?|cria|gerar?|adicion\w+|inserir?|abrir?|lan[cç]ar?|fa[çc]a|fazer|quero|preciso|gostaria)\b[\s\S]*?\b(?:clientes?|partes?|requerentes?|requerid[oa]s?|r[eé]us?|autor(?:es|a|as)?|executad[oa]s?|processos?|peti[çc][aã]o|nota|tarefa|agenda|compromisso|s[óo]cios?|herdeiros?|litisconsortes?)\b\s*(?:d[eo]\s+\w+|dess[ea]s?\s+\w+|do\s+documento|do\s+arquivo|da\s+peti[çc][aã]o|anexad[oa]s?|em\s+anexo|anexos?|acima|abaixo)?\s*[:,.]?\s*/i;
  return text.replace(re, "").trim();
}

// Quantos clientes cadastrar e quais. "cadastre o cliente" → one; "cadastre as
// duas partes / os clientes / todas as partes" → all; "cadastre os clientes
// Saher e Cláudia" → named (lista de nomes).
function parseClientCommand(text) {
  if (!text) return { mode: "one", names: [], side: "ativo" };
  const t = normalize(text);
  // Lado do cliente: o cliente pode ser o RÉU. "réu/requerido/executado" → passivo;
  // "autor/requerente/exequente" → ativo; senão o padrão (ativo).
  const side = /\br[eé]us?\b|\brequerid[oa]s?\b|\bexecutad[oa]s?\b|\breclamad[oa]s?\b|\bpromovid[oa]s?\b|\bparte\s+r[eé]|\bparte\s+passiva|\bapelad[oa]|\bagravad[oa]/.test(t) ? "passivo"
    : /\bautor(?:es|a|as)?\b|\brequerentes?\b|\bexequentes?\b|\breclamantes?\b|\bparte\s+ativa|\bapelantes?\b|\bagravantes?\b/.test(t) ? "ativo"
    : "ativo";
  // Sem flag "i": o nome precisa começar em MAIÚSCULA (senão "partes e o processo"
  // casaria o "e"). Aceita o rótulo com inicial maiúscula ou minúscula.
  const nm = text.match(/\b(?:[Cc]lientes|[Pp]artes|[Rr][eé]us|[Rr]equerid[oa]s?|[Rr]equerentes|[Aa]utores|[Ee]xecutad[oa]s?|[Ss][óoÓO]cios|[Hh]erdeiros|[Ll]itisconsortes)\s+([A-ZÀ-Ý][^\n.;]*)/);
  let names = [];
  if (nm) names = nm[1].split(/\s*,\s*|\s+e\s+/i).map(cleanNameFragment).filter(Boolean).slice(0, 8);
  if (names.length) return { mode: "named", names, side };
  // "todas"/plural → todas as partes; singular ("o cliente", "a parte") → uma.
  const all = /\btodas?\s+as\b|\bambas?\b|\bambos\b|\bas\s+duas\b|\bos\s+dois\b|\bv[áa]ri[oa]s\b|\bclientes\b|\bpartes\b|\brequerentes\b|\br[eé]us\b|\bautores\b|\bherdeiros\b|\bs[óo]cios\b|\blitisconsortes\b/.test(t);
  return all ? { mode: "all", names: [], side } : { mode: "one", names: [], side };
}
function cleanNameFragment(s) {
  if (!s) return "";
  const CLAUSE = new Set(["no", "na", "conforme", "com", "que", "processo", "acao", "peticao", "anexa", "anexo", "documento", "referente", "cujo", "cuja"]);
  const parts = [];
  for (const w of s.trim().replace(/^(?:sr[a]?\.?|dr[a]?\.?)\s+/i, "").split(/\s+/)) {
    if (CLAUSE.has(normalize(w))) break;
    parts.push(w);
    if (parts.length >= 4) break;
  }
  const first = normalize(parts[0] || "");
  const bloq = new Set(["fulano", "beltrano", "sicrano", "peticao", "anexa", "anexo", "documento", "cliente", "clientes", "parte", "partes", "todas", "todos", "ambas", "ambos"]);
  if (!parts.length || bloq.has(first)) return "";
  return parts.join(" ").split(/\s+/).map((w) => /^(d[aeo]s?|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
// Casa cada nome pedido ("Saher", "Cláudia") com a parte lida correspondente.
// Se o único "match" for um bloco que também casa com outro nome pedido
// (ex.: uma parte lida como "Saher e Cláudia"), ignora o bloco e cria a parte
// só com o nome — assim cada nome vira um cartão separado.
function pickNamed(pool, names) {
  return names.map((nm) => {
    const clean = pool.find((p) => nameMatches(p.nome, nm) &&
      !names.some((o) => o !== nm && nameMatches(p.nome, o)));
    return clean || { nome: nm };
  });
}
// Nome A "casa" com o nome B? (um contém o outro, ou compartilham a maioria dos tokens)
function nameMatches(a, b) {
  const na = normalize(a || ""), nb = normalize(b || "");
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(/\s+/).filter((w) => w.length >= 3));
  const tb = nb.split(/\s+/).filter((w) => w.length >= 3);
  return tb.length ? tb.filter((w) => ta.has(w)).length / tb.length >= 0.5 : false;
}
