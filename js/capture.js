// Captura rápida inteligente: o usuário escreve/fala/sobe arquivo, o sistema
// interpreta e monta um cartão EDITÁVEL (título, descrição, área, data, hora,
// prioridade, cliente e processo detectados) para ajuste antes de gerar.

import { el, prettyDate, toast } from "./ui.js";
import { parseNaturalTask, shortTitle, isLongText } from "./nlp.js";
import { extractTextFromFile } from "./files.js";
import { list } from "./store.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const normalize = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Detecta cliente e processo a partir do texto livre.
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

export function mountCapture(defaultArea, onCreate) {
  const textarea = el("textarea", {
    class: "capture-input", rows: "2",
    placeholder: "Descreva… ex: “Recurso de Agravo Simone amanhã 14h”",
  });
  const status = el("div", { class: "capture-status" });
  const editWrap = el("div", { class: "cap-edit hidden" });

  const micBtn = el("button", { type: "button", class: "cap-btn", title: "Gravar áudio" }, [icon("🎤"), "Falar"]);
  const fileBtn = el("button", { type: "button", class: "cap-btn", title: "Subir arquivo" }, [icon("📎"), "Arquivo"]);
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,text/plain", multiple: "" });
  const prepBtn = el("button", { type: "button", class: "btn btn-primary cap-submit" }, "Preparar →");

  const card = el("div", { class: "card capture" }, [
    el("div", { class: "capture-head" }, [icon("✨"), el("span", {}, "Captura rápida")]),
    textarea,
    status,
    el("div", { class: "capture-actions" }, [micBtn, fileBtn, el("span", { class: "grow" }), prepBtn]),
    editWrap,
    fileInput,
  ]);

  // ---------- preparar (parse + detecção) ----------
  async function prepare() {
    const raw = textarea.value.trim();
    if (!raw) { textarea.focus(); return; }
    status.textContent = "Analisando…";
    const p = parseNaturalTask(raw, defaultArea);
    let clients = [], processes = [];
    try { [clients, processes] = await Promise.all([list("clients", { orderBy: "nome", asc: true }), list("processes")]); } catch {}
    const det = detectLinks(raw, clients, processes);
    status.textContent = "";
    buildForm(p, det, clients, processes, raw);
  }
  prepBtn.addEventListener("click", prepare);
  textarea.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); prepare(); } });

  // ---------- cartão editável ----------
  function buildForm(p, det, clients, processes, raw) {
    const linkedArea = det.client || det.process ? "profissional" : p.area;
    let area = linkedArea;

    // Texto longo (ex: mensagem colada) → título curto + descrição com o conteúdo
    const longo = isLongText(raw);
    const tituloInicial = longo ? shortTitle(p.title || raw) : (p.title || "");
    const descInicial = longo ? raw.trim() : "";
    const title = el("input", { class: "form-control", value: tituloInicial, placeholder: "Título" });
    const desc = el("textarea", { class: "form-control", rows: longo ? "4" : "2", placeholder: "Descrição (opcional)" }, descInicial);
    const date = el("input", { class: "form-control", type: "date", value: p.due_date || "" });
    const time = el("input", { class: "form-control", type: "time", value: p.due_time || "" });
    const prio = el("select", { class: "form-control" });
    [["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"]].forEach(([v, l]) => prio.append(el("option", { value: v, ...(v === p.priority ? { selected: "" } : {}) }, l)));

    const segP = el("button", { type: "button", class: "seg-p" }, "🧑 Pessoal");
    const segT = el("button", { type: "button", class: "seg-t" }, "💼 Trabalho");
    const seg = el("div", { class: "seg" }, [segP, segT]);
    const cliLabel = el("span");
    const procLabel = el("span");
    const cliHint = el("div", { class: "t2", style: "margin-top:-4px" });
    const updateLabels = () => {
      const pessoal = area === "pessoal";
      cliLabel.textContent = pessoal ? "🔒 Vincular a um cliente (opcional, só seu)" : "Cliente";
      procLabel.textContent = pessoal ? "🔒 Processo (opcional, só seu)" : "Processo";
      cliHint.textContent = pessoal ? "Vínculo só para seu controle — NÃO aparece na pasta do cliente." : "";
      cliHint.style.display = pessoal ? "block" : "none";
    };
    const paintSeg = () => {
      segP.classList.toggle("active", area === "pessoal");
      segT.classList.toggle("active", area === "profissional");
      updateLabels();
    };
    segP.onclick = () => { area = "pessoal"; paintSeg(); };
    segT.onclick = () => { area = "profissional"; paintSeg(); };
    paintSeg();

    const cliSel = el("select", { class: "form-control" });
    cliSel.append(el("option", { value: "" }, "— nenhum —"));
    clients.forEach((c) => cliSel.append(el("option", { value: c.id, ...(det.client && det.client.id === c.id ? { selected: "" } : {}) }, c.nome)));
    const procSel = el("select", { class: "form-control" });
    const procInfo = el("div", { class: "cap-procinfo" });
    const fillProcs = () => {
      const cid = cliSel.value;
      procSel.innerHTML = "";
      procSel.append(el("option", { value: "" }, "— nenhum —"));
      processes.filter((p2) => !cid || p2.client_id === cid).forEach((p2) =>
        procSel.append(el("option", { value: p2.id, ...(det.process && det.process.id === p2.id ? { selected: "" } : {}) }, p2.nome)));
      showProcInfo();
    };
    const showProcInfo = () => {
      const p2 = processes.find((x) => x.id === procSel.value);
      procInfo.innerHTML = "";
      if (p2) {
        const bits = [p2.num ? "Nº " + p2.num : "", p2.vara || "", p2.fase || ""].filter(Boolean);
        if (bits.length) procInfo.append(el("div", { class: "t2" }, "⚖️ " + bits.join(" · ")));
      }
    };
    cliSel.addEventListener("change", fillProcs);  // não força mais a área — respeita sua escolha
    procSel.addEventListener("change", showProcInfo);
    fillProcs();

    const gerar = el("button", { type: "button", class: "btn btn-primary btn-block" }, "✓ Gerar tarefa");
    const cancelar = el("button", { type: "button", class: "btn btn-ghost btn-block" }, "Cancelar");

    gerar.onclick = async () => {
      if (!title.value.trim()) { title.focus(); return; }
      gerar.disabled = true;
      const task = {
        title: title.value.trim(), description: desc.value.trim(), area,
        priority: prio.value, due_date: date.value || null, due_time: time.value || null,
        client_id: cliSel.value || null, process_id: procSel.value || null, done: false,
      };
      try {
        const saved = await onCreate(task);
        reset();
        const partes = [area === "profissional" ? "💼 Trabalho" : "🧑 Pessoal"];
        if (task.due_date) partes.push("📅 " + prettyDate(task.due_date) + (task.due_time ? " " + task.due_time : ""));
        if (cliSel.value) partes.push("👤 " + cliSel.selectedOptions[0].textContent);
        toast(`✅ “${task.title}” · ${partes.join(" · ")}`, {
          action: saved ? { label: "Desfazer", onClick: () => onCreate.__undo && onCreate.__undo(saved) } : null,
        });
      } finally { gerar.disabled = false; }
    };
    cancelar.onclick = reset;

    editWrap.innerHTML = "";
    editWrap.append(
      field("Título", title),
      field("Descrição", desc),
      field("Área", seg),
      el("div", { class: "cap-row" }, [field("Data", date), field("Hora", time), field("Prioridade", prio)]),
      field(cliLabel, cliSel),
      cliHint,
      field(procLabel, procSel),
      procInfo,
      el("div", { class: "cap-gen" }, [cancelar, gerar]),
    );
    editWrap.classList.remove("hidden");
    prepBtn.classList.add("hidden");
    title.focus();
  }

  function reset() {
    textarea.value = ""; editWrap.innerHTML = ""; editWrap.classList.add("hidden");
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
    };
    const stop = () => { rec = null; micBtn.classList.remove("recording"); micBtn.innerHTML = ""; micBtn.append(icon("🎤"), "Falar"); status.textContent = ""; };
    rec.onend = stop;
    rec.onerror = (ev) => { stop(); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") toast("Permita o acesso ao microfone para gravar."); };
    rec.start();
  });

  // ---------- arquivo ----------
  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files]; fileInput.value = "";
    for (const file of files) {
      status.textContent = `📄 Lendo “${file.name}”…`;
      try {
        const text = await extractTextFromFile(file, (msg) => { status.textContent = msg; });
        if (text && text.trim()) { textarea.value = (textarea.value.trim() + " " + text.trim()).trim(); status.textContent = `✅ Texto extraído. Toque em Preparar.`; }
        else status.textContent = `⚠️ Não consegui extrair texto de “${file.name}”.`;
      } catch (err) { status.textContent = `⚠️ Erro ao ler “${file.name}”: ${err.message || err}`; }
    }
  });

  return card;
}

function field(label, control) { return el("label", { class: "cap-field" }, [label, control]); }
function icon(emoji) { return el("span", { class: "cap-ico" }, emoji); }
