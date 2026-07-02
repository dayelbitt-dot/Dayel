// Componente de "captura rápida": o usuário escreve, fala (áudio → texto)
// ou sobe um arquivo; o sistema interpreta e cadastra a tarefa sozinho.

import { el, prettyDate, toast } from "./ui.js";
import { parseNaturalTask } from "./nlp.js";
import { extractTextFromFile } from "./files.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const AREA_LABEL = { pessoal: "🧑 Pessoal", profissional: "💼 Trabalho" };
const PRIO_LABEL = { alta: "⚡ Alta", media: null, baixa: "🐢 Baixa" };

// container: elemento onde montar. onCreate(task): chamado após inserir.
export function mountCapture(defaultArea, onCreate) {
  const textarea = el("textarea", {
    class: "capture-input", rows: "2",
    placeholder: "Descreva a tarefa… ex: “ligar para o cliente amanhã de manhã, urgente”",
  });

  const preview = el("div", { class: "capture-preview" });
  const status = el("div", { class: "capture-status" });

  const micBtn = el("button", { type: "button", class: "cap-btn", title: "Gravar áudio" }, [icon("🎤"), "Falar"]);
  const fileBtn = el("button", { type: "button", class: "cap-btn", title: "Subir arquivo" }, [icon("📎"), "Arquivo"]);
  const fileInput = el("input", { type: "file", class: "hidden", accept: "image/*,.pdf,.txt,.md,.csv,text/plain", multiple: "" });
  const submitBtn = el("button", { type: "button", class: "btn btn-primary cap-submit" }, "Cadastrar");

  const card = el("div", { class: "card capture" }, [
    el("div", { class: "capture-head" }, [icon("✨"), el("span", {}, "Captura rápida")]),
    textarea,
    preview,
    status,
    el("div", { class: "capture-actions" }, [micBtn, fileBtn, el("span", { class: "grow" }), submitBtn]),
    fileInput,
  ]);

  // ---------- pré-visualização ao vivo ----------
  function updatePreview() {
    const p = parseNaturalTask(textarea.value, defaultArea);
    preview.innerHTML = "";
    if (!p || !textarea.value.trim()) return;
    const chips = [];
    chips.push(chip(AREA_LABEL[p.area] || "🧑 Pessoal"));
    if (PRIO_LABEL[p.priority]) chips.push(chip(PRIO_LABEL[p.priority]));
    if (p.due_date) chips.push(chip("📅 " + prettyDate(p.due_date)));
    preview.append(
      el("div", { class: "cap-title" }, "→ " + p.title),
      el("div", { class: "cap-chips" }, chips),
    );
  }
  textarea.addEventListener("input", updatePreview);

  // ---------- cadastrar ----------
  async function doSubmit() {
    const raw = textarea.value.trim();
    if (!raw) { textarea.focus(); return; }
    const p = parseNaturalTask(raw, defaultArea);
    submitBtn.disabled = true;
    try {
      const task = await onCreate({ title: p.title, area: p.area, priority: p.priority, due_date: p.due_date, done: false });
      textarea.value = ""; updatePreview(); status.textContent = "";
      const partes = [AREA_LABEL[p.area]];
      if (p.due_date) partes.push("📅 " + prettyDate(p.due_date));
      if (PRIO_LABEL[p.priority]) partes.push(PRIO_LABEL[p.priority]);
      toast(`✅ “${p.title}” · ${partes.join(" · ")}`, {
        action: task ? { label: "Desfazer", onClick: () => onCreate.__undo && onCreate.__undo(task) } : null,
      });
    } finally {
      submitBtn.disabled = false;
    }
  }
  submitBtn.addEventListener("click", doSubmit);
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSubmit(); }
  });

  // ---------- áudio → texto (Web Speech API) ----------
  let rec = null;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = "Seu navegador não suporta gravação de voz";
  } else {
    micBtn.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
      let base = textarea.value ? textarea.value.trim() + " " : "";
      micBtn.classList.add("recording");
      micBtn.innerHTML = ""; micBtn.append(icon("⏺"), "Ouvindo…");
      status.textContent = "🎙️ Fale agora… (toque de novo para parar)";
      rec.onresult = (e) => {
        let interim = "", final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t + " "; else interim += t;
        }
        if (final) base += final;
        textarea.value = (base + interim).replace(/\s+/g, " ").trimStart();
        updatePreview();
      };
      const stop = () => {
        rec = null;
        micBtn.classList.remove("recording");
        micBtn.innerHTML = ""; micBtn.append(icon("🎤"), "Falar");
        status.textContent = "";
      };
      rec.onend = stop;
      rec.onerror = (ev) => {
        stop();
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed")
          toast("Permita o acesso ao microfone para gravar.");
      };
      rec.start();
    });
  }

  // ---------- upload de arquivo → texto ----------
  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    if (!files.length) return;
    for (const file of files) {
      status.textContent = `📄 Lendo “${file.name}”…`;
      try {
        const text = await extractTextFromFile(file, (msg) => { status.textContent = msg; });
        if (text && text.trim()) {
          textarea.value = (textarea.value.trim() + " " + text.trim()).trim();
          updatePreview();
          status.textContent = `✅ Texto extraído de “${file.name}”. Confira e toque em Cadastrar.`;
        } else {
          status.textContent = `⚠️ Não consegui extrair texto de “${file.name}”.`;
        }
      } catch (err) {
        status.textContent = `⚠️ Erro ao ler “${file.name}”: ${err.message || err}`;
      }
    }
  });

  return card;
}

function chip(label) { return el("span", { class: "cap-chip" }, label); }
function icon(emoji) { return el("span", { class: "cap-ico" }, emoji); }
