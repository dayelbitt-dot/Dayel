// Captura rápida multi-tipo: o usuário escreve/fala/sobe arquivos, ESCOLHE um ou
// mais destinos (Tarefa, Agenda, Nota, Cliente, Processo) e o sistema monta um
// cartão EDITÁVEL para cada um — já preenchido com o que conseguiu interpretar do
// texto e dos documentos. Ao gerar, cria todos de uma vez e, quando Cliente e
// Processo são escolhidos juntos, faz o cadastro completo dos dois e VINCULA
// automaticamente o processo ao cliente novo.

import { el, prettyDate, todayISO, toast } from "./ui.js";
import { parseNaturalTask, shortTitle, isLongText } from "./nlp.js";
import { extractTextFromFile } from "./files.js";
import { extractClient, extractProcess, parseMoney } from "./extract.js";
import { aiEnabled, aiExtract } from "./ai.js";
import { list, insert, remove } from "./store.js";
import * as gcal from "./gcal.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const normalize = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Destinos possíveis (multi-seleção).
const TYPES = [
  { key: "tarefa", ico: "✅", label: "Tarefa" },
  { key: "agenda", ico: "🗓️", label: "Agenda" },
  { key: "nota", ico: "📝", label: "Nota" },
  { key: "cliente", ico: "👤", label: "Cliente" },
  { key: "processo", ico: "⚖️", label: "Processo" },
];
// Ordem de criação (cliente antes do processo, para poder vincular).
const ORDER = ["cliente", "processo", "tarefa", "agenda", "nota"];

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
    placeholder: "Descreva ou cole aqui… ex: “Recurso de Agravo Simone amanhã 14h” — ou os dados do cliente/processo",
  });
  const status = el("div", { class: "capture-status" });

  // seletor de destinos
  const typesRow = el("div", { class: "cap-types" });
  const typeBtns = {};
  const paintTypes = () => TYPES.forEach((t) => typeBtns[t.key].classList.toggle("active", selected.has(t.key)));
  TYPES.forEach((t) => {
    const b = el("button", { type: "button", class: "cap-type", "data-k": t.key }, [icon(t.ico), t.label]);
    b.onclick = () => { typesTouched = true; selected.has(t.key) ? selected.delete(t.key) : selected.add(t.key); paintTypes(); saveDraft(); };
    typeBtns[t.key] = b;
    typesRow.append(b);
  });
  paintTypes();
  const typeHint = el("div", { class: "cap-typehint" }, "Escolha os destinos — ou anexe um documento e escreva a instrução (ex.: “cadastre o cliente” / “cadastre o processo”) que eu marco sozinho e puxo os dados do arquivo.");

  const micBtn = el("button", { type: "button", class: "cap-btn", title: "Gravar áudio" }, [icon("🎤"), "Falar"]);
  const fileBtn = el("button", { type: "button", class: "cap-btn", title: "Subir arquivos" }, [icon("📎"), "Arquivos"]);
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,text/plain", multiple: "" });
  const prepBtn = el("button", { type: "button", class: "btn btn-primary cap-submit" }, "Preparar →");

  const attWrap = el("div", { class: "att-list" });
  const cardsWrap = el("div", { class: "cap-cards hidden" });

  const card = el("div", { class: "card capture" }, [
    el("div", { class: "capture-head" }, [icon("✨"), el("span", {}, "Captura rápida")]),
    textarea,
    typesRow,
    typeHint,
    attWrap,
    status,
    el("div", { class: "capture-actions" }, [micBtn, fileBtn, el("span", { class: "grow" }), prepBtn]),
    cardsWrap,
    fileInput,
  ]);

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

    // Se o usuário não mexeu nos destinos, deduz da instrução ("cadastre o
    // cliente/processo", "criar nota", "agendar…").
    if (!typesTouched) { const intent = intentFromText(userText); if (intent.size) { selected.clear(); intent.forEach((k) => selected.add(k)); paintTypes(); } }
    if (!selected.size) { toast("Escolha ao menos um destino (Tarefa, Agenda, Nota, Cliente ou Processo)."); return; }

    status.textContent = "Analisando…";
    const combined = [userText, docText].filter(Boolean).join("\n\n");        // instrução + documentos (p/ extração)
    const cmdCli = commandName(userText, "cliente");                          // nome dito na instrução, se houver

    let clients = [], processes = [];
    try { [clients, processes] = await Promise.all([list("clients", { orderBy: "nome", asc: true }), list("processes")]); } catch {}
    const det = detectLinks(combined, clients, processes);                    // detecta cliente/processo já cadastrados (inclui o doc)
    const parsed = parseNaturalTask(userText, defaultArea) || { title: userText, area: defaultArea, priority: "media", due_date: null, due_time: null };

    // Leitura dos campos de cliente/processo: IA (quando configurada) na frente,
    // regras (extract.js) preenchendo o que faltar. Se a IA não estiver
    // disponível, usa só as regras — sem travar.
    let aiCli = null, aiProc = null;
    if (aiEnabled() && combined && (selected.has("cliente") || selected.has("processo"))) {
      status.textContent = "🤖 Lendo o documento com IA…";
      try { const ai = await aiExtract(combined, [...selected].filter((k) => k === "cliente" || k === "processo")); if (ai) { aiCli = ai.cliente; aiProc = ai.processo; } } catch {}
    }
    status.textContent = "";
    const exCli = mergeFields(aiCli, extractClient(combined));
    const exProc = mergeFields(aiProc, extractProcess(combined));

    cards = [];
    cardsWrap.innerHTML = "";
    const bothCliProc = selected.has("cliente") && selected.has("processo");

    for (const key of ORDER) {
      if (!selected.has(key)) continue;
      let ctrl = null;
      if (key === "cliente") ctrl = buildClientCard(exCli, cmdCli);
      else if (key === "processo") ctrl = buildProcessCard(exProc, det, clients, bothCliProc, cmdCli, exCli.nome);
      else if (key === "tarefa") ctrl = buildTaskCard(parsed, det, clients, processes, userText);
      else if (key === "agenda") ctrl = buildAgendaCard(parsed, userText);
      else if (key === "nota") ctrl = buildNoteCard(parsed, userText);
      if (ctrl) { cards.push(ctrl); cardsWrap.append(ctrl.node); }
    }

    const gerar = el("button", { type: "button", class: "btn btn-primary btn-block" }, "✓ Gerar tudo");
    const cancelar = el("button", { type: "button", class: "btn btn-ghost btn-block" }, "Cancelar");
    gerar.onclick = () => generate(gerar);
    cancelar.onclick = reset;
    cardsWrap.append(el("div", { class: "cap-gen" }, [cancelar, gerar]));

    status.textContent = "";
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

  async function generate(btn) {
    // validação
    for (const c of cards) { const err = c.validate && c.validate(); if (err) { toast(err.msg); err.focus && err.focus(); return; } }
    btn.disabled = true;
    const undo = [];      // {table,id} ou {gcalId}
    const feitos = [];    // rótulos para o aviso
    try {
      const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
      let newClient = null;
      // Anexos salvos no registro: só os que couberam (têm data) e SEM o texto
      // lido (o texto serviu para preencher os campos; não precisa ir ao banco).
      const savable = attachments.filter((a) => a.data).map(({ text, ...a }) => a);

      if (byKey.cliente) {
        const data = { ...byKey.cliente.collect(), attachments: savable };
        const saved = await insert("clients", data);
        if (saved) { undo.push({ table: "clients", id: saved.id }); newClient = saved; }
        feitos.push("👤 Cliente “" + data.nome + "”");
      }
      if (byKey.processo) {
        const data = { ...byKey.processo.collect(), attachments: savable };
        if (newClient) data.client_id = newClient.id; // VÍNCULO automático
        const saved = await insert("processes", data);
        if (saved) undo.push({ table: "processes", id: saved.id });
        feitos.push("⚖️ Processo “" + data.nome + "”" + (newClient ? " (vinculado)" : ""));
      }
      if (byKey.tarefa) {
        const data = { ...byKey.tarefa.collect(), attachments: savable };
        const saved = await insert("tasks", data);
        if (saved) undo.push({ table: "tasks", id: saved.id });
        feitos.push(taskLabel("✅ Tarefa", data));
      }
      if (byKey.agenda) {
        const { task, gcalWanted } = byKey.agenda.collect();
        const saved = await insert("tasks", { ...task, attachments: savable });
        if (saved) undo.push({ table: "tasks", id: saved.id });
        feitos.push(taskLabel("🗓️ Agenda", task));
        if (gcalWanted) {
          try { const ev = await gcal.createEvent({ title: task.title, date: task.due_date, time: task.due_time, description: task.description }); if (ev && ev.id) undo.push({ gcalId: ev.id }); }
          catch (err) { toast("Salvo aqui, mas falhou no Google: " + (err.message || "")); }
        }
      }
      if (byKey.nota) {
        const data = { ...byKey.nota.collect(), attachments: savable };
        const saved = await insert("notes", data);
        if (saved) undo.push({ table: "notes", id: saved.id });
        feitos.push("📝 Nota");
      }

      reset();
      toast("✅ Criado: " + feitos.join(" · "), {
        action: undo.length ? { label: "Desfazer", onClick: async () => { await undoAll(undo); onDone(); toast("Cadastro desfeito."); } } : null,
      });
      onDone();
    } catch (err) {
      // Falha no meio do caminho: desfaz o que já entrou para não deixar
      // registros órfãos (ex.: cliente criado mas processo falhou).
      await undoAll(undo);
      if (undo.length) onDone();
      toast("Não consegui salvar tudo — nada foi cadastrado. " + (err?.message || err));
    } finally { btn.disabled = false; }
  }

  function reset() {
    textarea.value = ""; attachments = []; cards = [];
    clearDraft();
    drawAtts();
    cardsWrap.innerHTML = ""; cardsWrap.classList.add("hidden");
    prepBtn.classList.remove("hidden"); status.textContent = "";
  }

  // ---------- áudio ----------
  let rec = null;
  if (!SR) { micBtn.disabled = true; micBtn.title = "Seu navegador não suporta gravação de voz"; }
  else micBtn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
    let base = textarea.value ? textarea.value.trim() + " " : "";
    micBtn.classList.add("recording"); micBtn.innerHTML = ""; micBtn.append(icon("⏺"), "Ouvindo…");
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
    const stop = () => { rec = null; micBtn.classList.remove("recording"); micBtn.innerHTML = ""; micBtn.append(icon("🎤"), "Falar"); status.textContent = ""; };
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
      else status.textContent = `📎 “${file.name}” anexado.`;
      saveDraft();
    }
  });

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

function cardShell(ico, title, autofilled, children) {
  const head = el("div", { class: "cap-card-head" }, [icon(ico), el("span", {}, title)]);
  if (autofilled) head.append(el("span", { class: "cap-autofill" }, "✨ preenchido automaticamente"));
  return el("div", { class: "cap-card" }, [head, ...children]);
}
function hasAny(obj, keys) { return keys.some((k) => obj[k] != null && obj[k] !== "" && obj[k] !== "1"); }

// ---------- CLIENTE ----------
function buildClientCard(ex, cmdName) {
  const auto = !!cmdName || hasAny(ex, ["nome", "cpf", "rg", "tel", "email", "nasc", "endereco", "area", "origem", "obs"]);
  // Nome dito na instrução ("cadastre o cliente Fulano") tem prioridade; o resto
  // (CPF, RG, endereço…) vem do documento anexado.
  const nome = inp("Nome completo *", cmdName || ex.nome, { required: "" });
  const cpf = inp("000.000.000-00 (ou CNPJ)", ex.cpf);
  const rg = inp("RG", ex.rg);
  const tel = inp("(51) 9 0000-0000", ex.tel);
  const email = inp("email@exemplo.com", ex.email, { type: "email" });
  const nasc = inp("", ex.nasc, { type: "date" });
  const endereco = inp("Rua, nº, bairro, cidade — UF", ex.endereco);
  const area = inp("Ex: Família, Cível…", ex.area);
  const origem = inp("Ex: Indicação, Instagram…", ex.origem);
  const obs = txt("Resumo do caso, histórico…", ex.obs, 2);

  const node = cardShell("👤", "Novo cliente", auto, [
    field("Nome *", nome),
    el("div", { class: "cap-row" }, [field("CPF / CNPJ", cpf), field("RG", rg)]),
    el("div", { class: "cap-row" }, [field("Telefone / WhatsApp", tel), field("Nascimento", nasc)]),
    field("E-mail", email),
    field("Endereço", endereco),
    el("div", { class: "cap-row" }, [field("Área", area), field("Origem", origem)]),
    field("Observações", obs),
  ]);
  return {
    key: "cliente", node,
    validate: () => (!nome.value.trim() ? { msg: "Informe o nome do cliente.", focus: () => nome.focus() } : null),
    collect: () => ({ nome: nome.value.trim(), cpf: cpf.value.trim(), rg: rg.value.trim(), tel: tel.value.trim(), email: email.value.trim(), nasc: nasc.value || null, endereco: endereco.value.trim(), area: area.value.trim(), origem: origem.value.trim(), obs: obs.value.trim() }),
  };
}

// ---------- PROCESSO ----------
function buildProcessCard(ex, det, clients, linkedToNewClient, cmdName, newClientName) {
  const auto = hasAny(ex, ["num", "tipo", "vara", "tribunal", "partes", "data_distribuicao", "fase", "valor"]) || ex.grau === "2";
  const num = inp("0000000-00.0000.8.21.0000", ex.num);
  // Nome sugerido: "Tipo — Cliente". Quando o Cliente também está sendo criado,
  // usa o nome dito na instrução / extraído do cliente novo; senão, o cliente
  // detectado (já cadastrado); por fim, a parte contrária (para nunca ficar vazio).
  const linkedName = linkedToNewClient ? (cmdName || newClientName || "") : (det.client ? det.client.nome : "");
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
    linkNote = el("div", { class: "cap-linknote" }, "🔗 Será vinculado automaticamente ao cliente novo (cartão acima).");
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

  const node = cardShell("⚖️", "Novo processo", auto, children);
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

  const segP = el("button", { type: "button", class: "seg-p" }, "🧑 Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "💼 Trabalho");
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
    cliLabel.textContent = pessoal ? "🔒 Vincular a um cliente (opcional, só seu)" : "Cliente (opcional)";
    procLabel.textContent = pessoal ? "🔒 Processo (opcional, só seu)" : "Processo (opcional)";
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

  const node = cardShell("✅", "Nova tarefa", false, [
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
  const segP = el("button", { type: "button", class: "seg-p" }, "🧑 Pessoal");
  const segT = el("button", { type: "button", class: "seg-t" }, "💼 Trabalho");
  const seg = el("div", { class: "seg" }, [segP, segT]);
  const paintSeg = () => { segP.classList.toggle("active", area === "pessoal"); segT.classList.toggle("active", area === "profissional"); };
  segP.onclick = () => { area = "pessoal"; paintSeg(); };
  segT.onclick = () => { area = "profissional"; paintSeg(); };
  paintSeg();

  const gChk = el("input", { type: "checkbox" });
  const gRow = gcal.isConnected() ? el("label", { class: "cap-field", style: "flex-direction:row; align-items:center; gap:8px" }, [gChk, el("span", {}, "📅 Criar também no Google Agenda")]) : null;

  const node = cardShell("🗓️", "Novo compromisso", !!(p.due_date || p.due_time), [
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
  const node = cardShell("📝", "Nova nota", false, [field("Título", title), field("Conteúdo", body)]);
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
  if (cadastro && /\bclientes?\b/.test(t)) set.add("cliente");
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
