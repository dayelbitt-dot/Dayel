// ================================================================
//  RESUMO DO DIA — o briefing automático de todo dia (por padrão, 8h)
// ----------------------------------------------------------------
//  Todo dia monta um resumo direto, em português, cruzando:
//   1) Google Agenda — compromissos/audiências/prazos de HOJE e AMANHÃ
//      (com horário e local);
//   2) Gmail — mensagens NÃO LIDAS das últimas 24h, destacando as que
//      pedem atenção (clientes cadastrados, tribunais/cartórios e
//      possíveis prazos processuais) e contando o resto.
//
//  Tudo roda no navegador (mesmo esquema do resto do app): usa as
//  integrações que já existem (js/gcal.js e js/gmail.js). Nada é
//  enviado para servidores de IA.
//
//  "Às 8h": um PWA não roda sozinho em segundo plano de forma
//  garantida. Então o resumo é gerado quando o app está aberto e, a
//  partir das 8h, dispara UMA notificação por dia (se você permitir).
//  Ao abrir o app, o resumo do dia já vem pronto no cartão da Home.
// ================================================================

import { $, el, todayISO, prettyDate, toast } from "./ui.js";
import { list } from "./store.js";
import * as gcal from "./gcal.js";
import * as gmail from "./gmail.js";

const CACHE_KEY = "resumo:cache";       // último resumo montado (por dia)
const NOTIFY_KEY = "resumo:notify";     // "1" = avisar às 8h
const NOTIFIED_KEY = "resumo:notified"; // ISO do dia já notificado
const HORA_KEY = "resumo:hora";         // hora do aviso (HH:MM), padrão 08:00

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + "s")}`;

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// ---------------- cache (por dia, no aparelho) ----------------
export function loadResumo() {
  try { const v = JSON.parse(localStorage.getItem(CACHE_KEY)); return v && typeof v === "object" ? v : null; }
  catch { return null; }
}
function saveResumo(r) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(r)); } catch {} }
// Só serve o cache se for do dia de hoje (senão está velho).
export function resumoDeHoje() { const r = loadResumo(); return r && r.data === todayISO() ? r : null; }

const notifyOn = () => localStorage.getItem(NOTIFY_KEY) === "1";
const horaAviso = () => localStorage.getItem(HORA_KEY) || "08:00";

// ---------------- classificação dos e-mails ----------------
// Cruza cada e-mail não lido com os clientes cadastrados e com sinais de
// tribunal/cartório e prazo, devolvendo os MOTIVOS que o tornam relevante.
function matchCliente(msg, clients) {
  const fromEmail = msg.fromEmail || "";
  const fromNome = norm(msg.fromNome);
  for (const c of clients) {
    const cemail = (c.email || "").trim().toLowerCase();
    if (cemail && cemail === fromEmail) return c;
  }
  // Por nome: exige pelo menos 2 tokens significativos batendo (evita falso
  // positivo com um primeiro nome comum).
  for (const c of clients) {
    const toks = norm(c.nome).split(/\s+/).filter((w) => w.length >= 3);
    if (toks.length >= 2 && toks.every((w) => fromNome.includes(w))) return c;
  }
  return null;
}

const RE_TRIBUNAL_DOM = /(tj[a-z]{2}|trf\d|trt\d{1,2}|\btst\b|\bstj\b|\bstf\b|\btse\b|jus\.br|eproc|\bpje\b|projudi|esaj|cart[oó]rio|tabeli|notari)/;
const RE_TRIBUNAL_TXT = /tribunal|f[oó]rum|\bvara\b|comarca|juizad|cart[oó]rio|tabeli|of[ií]cio\s+de|intima[çc]|\beproc\b|\bpje\b|projudi/;
const RE_PRAZO = /\bprazo\b|intima[çc][aã]o|audi[êe]ncia|\bcita[çc][aã]o\b|contesta[çc]|contrarraz|\brecurso\b|apela[çc]|senten[çc]a|\bdespacho\b|\bpeti[çc][aã]o\b|\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

function classificar(msg, clients) {
  const dom = norm(msg.fromEmail);
  const hay = norm(msg.subject + " " + msg.snippet);
  const motivos = [];
  const cli = matchCliente(msg, clients);
  if (cli) motivos.push({ tipo: "cliente", texto: "Cliente: " + (cli.nome || "").split(/\s+/).slice(0, 3).join(" "), clientId: cli.id });
  if (RE_TRIBUNAL_DOM.test(dom) || RE_TRIBUNAL_TXT.test(hay)) motivos.push({ tipo: "tribunal", texto: "Tribunal/cartório" });
  if (RE_PRAZO.test(hay)) motivos.push({ tipo: "prazo", texto: "Possível prazo processual" });
  return motivos;
}

// ---------------- geração do resumo ----------------
// Monta o objeto do resumo cruzando Agenda + Gmail. Não conecta sozinho: só usa
// o que já está conectado. Persiste o resultado no aparelho.
export async function gerarResumo() {
  const hoje = todayISO();
  const amanha = addDaysISO(hoje, 1);
  const calOk = gcal.isConnected();
  const gmailOk = gmail.isConnected();

  let hojeEv = [], amanhaEv = [];
  if (calOk) {
    try {
      const ini = new Date(hoje + "T00:00:00");
      const fim = new Date(amanha + "T23:59:59");
      const evs = await gcal.listEvents(ini.toISOString(), fim.toISOString());
      const ord = (a, b) => ((a.time || "99:99") < (b.time || "99:99") ? -1 : 1);
      hojeEv = evs.filter((e) => e.date === hoje).sort(ord);
      amanhaEv = evs.filter((e) => e.date === amanha).sort(ord);
    } catch { /* mantém vazio */ }
  }

  let atencao = [], outros = 0, total = 0;
  if (gmailOk) {
    let clients = [];
    try { clients = await list("clients"); } catch {}
    try {
      const msgs = await gmail.fetchMensagens("is:unread newer_than:1d", { max: 60 });
      total = msgs.length;
      for (const m of msgs) {
        const motivos = classificar(m, clients);
        if (motivos.length) {
          atencao.push({
            id: m.id, fromNome: m.fromNome, fromEmail: m.fromEmail,
            subject: m.subject || "(sem assunto)", snippet: (m.snippet || "").slice(0, 140),
            link: m.link, dateMs: m.dateMs, motivos,
          });
        } else outros++;
      }
    } catch { /* sem e-mails */ }
  }

  const r = {
    data: hoje, geradoEm: new Date().toISOString(),
    calOk, gmailOk, hoje: hojeEv, amanha: amanhaEv,
    atencao, outros, total,
  };
  saveResumo(r);
  return r;
}

// ---------------- resumo em texto (copiar / notificação) ----------------
const horaEv = (e) => e.time ? e.time + (e.endTime ? "–" + e.endTime : "") : "dia todo";
function linhaEvento(e) {
  return "• " + horaEv(e) + " — " + (e.title || "Compromisso") + (e.location ? " (" + e.location + ")" : "");
}

export function resumoTexto(r) {
  const L = [];
  L.push("☀️ Resumo do dia — " + prettyDate(r.data));
  L.push("");
  L.push("📅 Agenda de hoje");
  L.push(r.hoje.length ? r.hoje.map(linhaEvento).join("\n") : (r.calOk ? "• Nada agendado." : "• (Agenda não conectada)"));
  L.push("");
  L.push("📅 Agenda de amanhã");
  L.push(r.amanha.length ? r.amanha.map(linhaEvento).join("\n") : (r.calOk ? "• Nada agendado." : "• (Agenda não conectada)"));
  L.push("");
  L.push("📨 E-mails que precisam de atenção");
  if (!r.gmailOk) L.push("• (Gmail não conectado)");
  else if (!r.atencao.length) L.push("• Nenhum e-mail urgente nas últimas 24h.");
  else r.atencao.forEach((m) => L.push("• " + m.fromNome + " — " + m.subject + "  [" + m.motivos.map((x) => x.texto).join(", ") + "]"));
  L.push("");
  L.push("📬 Outros e-mails");
  L.push(r.gmailOk ? "• " + plural(r.outros, "e-mail não lido sem prazo/cliente aparente", "e-mails não lidos sem prazo/cliente aparente") + "." : "• (Gmail não conectado)");
  return L.join("\n");
}

// Versão curta para o corpo da notificação.
function resumoCurto(r) {
  const bits = [];
  bits.push(plural(r.hoje.length, "compromisso hoje", "compromissos hoje"));
  if (r.amanha.length) bits.push(plural(r.amanha.length, "amanhã"));
  if (r.gmailOk) bits.push(plural(r.atencao.length, "e-mail p/ atenção", "e-mails p/ atenção"));
  return bits.join(" · ");
}

// ================================================================
//  NOTIFICAÇÃO DIÁRIA (melhor esforço, com o app aberto a partir da hora)
// ================================================================
export function podeNotificar() { return typeof Notification !== "undefined"; }
export function permissaoNotif() { return podeNotificar() ? Notification.permission : "denied"; }

export async function ativarNotificacoes() {
  if (!podeNotificar()) throw new Error("Este navegador não suporta notificações.");
  let p = Notification.permission;
  if (p === "default") p = await Notification.requestPermission();
  if (p !== "granted") throw new Error("Permissão de notificação negada.");
  localStorage.setItem(NOTIFY_KEY, "1");
  return true;
}
export function desativarNotificacoes() { localStorage.setItem(NOTIFY_KEY, "0"); }

async function mostrarNotificacao(r) {
  const title = "☀️ Seu resumo do dia";
  const body = resumoCurto(r) || "Toque para ver o resumo de hoje.";
  const opts = { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag: "resumo-do-dia", data: { rota: "resumo" } };
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
      return;
    }
  } catch { /* cai para a Notification simples */ }
  try { new Notification(title, opts); } catch {}
}

// Passou da hora do aviso e ainda não notificou hoje?
function horaDeAvisar() {
  const [h, m] = horaAviso().split(":").map(Number);
  const agora = new Date();
  const alvo = new Date(); alvo.setHours(h || 8, m || 0, 0, 0);
  return agora >= alvo && localStorage.getItem(NOTIFIED_KEY) !== todayISO();
}

let schedulerStarted = false;
// Mantém o resumo do dia pronto (gera ao abrir o app) e, a partir da hora
// escolhida, dispara UMA notificação por dia. Roda enquanto o app está aberto.
export function startResumoScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    if (!gcal.googleEnabled()) return;
    const conectado = gcal.isConnected() || gmail.isConnected();
    if (!conectado) return;

    // 1) Garante o resumo de hoje pronto (para a Home/página), no máx. a cada 30 min.
    const atual = loadResumo();
    const frescoHoje = atual && atual.data === todayISO() && (Date.now() - Date.parse(atual.geradoEm || 0) < 30 * 60 * 1000);
    let r = frescoHoje ? atual : null;
    if (!r) { try { r = await gerarResumo(); } catch { r = atual; } }

    // 2) Notifica uma vez por dia, a partir da hora escolhida (se permitido).
    if (r && notifyOn() && permissaoNotif() === "granted" && horaDeAvisar()) {
      await mostrarNotificacao(r);
      localStorage.setItem(NOTIFIED_KEY, todayISO());
    }
  };

  tick();
  setInterval(tick, 5 * 60 * 1000); // reavalia a cada 5 min enquanto aberto
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  window.addEventListener("focus", tick);
}

// ================================================================
//  UI — cartão compacto da Home e página completa
// ================================================================

// Cartão compacto para o topo da Home. Mostra o essencial e leva à página.
export function resumoCard(navigate) {
  const r = resumoDeHoje();
  const card = el("button", { class: "card resumo-card", onclick: () => navigate("resumo") });
  const bits = [];
  if (r) {
    bits.push(plural(r.hoje.length, "compromisso hoje", "compromissos hoje"));
    if (r.amanha.length) bits.push(plural(r.amanha.length, "amanhã"));
    if (r.gmailOk && r.atencao.length) bits.push(plural(r.atencao.length, "e-mail p/ atenção", "e-mails p/ atenção"));
  }
  const sub = r ? (bits.join(" · ") || "Tudo tranquilo por aqui.") : "Toque para montar o resumo de hoje (Agenda + Gmail).";
  card.append(
    el("span", { class: "resumo-card-ic" }, "☀️"),
    el("span", { class: "resumo-card-body" }, [
      el("span", { class: "resumo-card-tit" }, "Resumo do dia"),
      el("span", { class: "resumo-card-sub" }, sub),
    ]),
    el("span", { class: "hoje-item-go" }, "›"),
  );
  return card;
}

let gerando = false;
export async function renderResumo(ctx) {
  const main = $("#main");
  const navigate = ctx.navigate;

  const head = el("div", {}, [
    el("button", { class: "btn btn-ghost btn-sm back-page", style: "margin-bottom:2px; align-self:flex-start", onclick: () => navigate("home") }, "‹ Voltar"),
    el("h1", { class: "page-title" }, "Resumo do dia"),
    el("p", { class: "page-sub" }, "Todo dia: sua agenda de hoje e amanhã + os e-mails que pedem atenção"),
  ]);

  if (!gcal.googleEnabled()) {
    main.innerHTML = "";
    main.append(head, el("div", { class: "empty" }, "Para usar o Resumo do dia, configure o Google (GOOGLE_CLIENT_ID) — veja o README."));
    return;
  }

  const draw = () => {
    main.innerHTML = "";
    const r = resumoDeHoje();
    const calOk = gcal.isConnected(), gmailOk = gmail.isConnected();

    // ---- barra de conexão / ações ----
    const bar = el("div", { class: "gbar" });
    const statusTxt = [calOk ? "✅ Agenda" : "○ Agenda", gmailOk ? "✅ Gmail" : "○ Gmail"].join("   ");
    bar.append(el("span", { class: "t2" }, gerando ? "🔄 Montando o resumo…" : statusTxt));
    const botoes = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap" });
    if (!calOk || !gmailOk) {
      botoes.append(el("button", { class: "btn btn-sm btn-primary", disabled: gerando ? "" : null, onclick: async () => {
        try { if (!calOk) await gcal.connect(true); } catch (e) { toast("Não consegui conectar a Agenda. " + (e?.message || "")); }
        try { if (!gmail.isConnected()) await gmail.connect(true); } catch (e) { toast("Não consegui conectar o Gmail. " + (e?.message || "")); }
        await gerar();
      } }, "🔗 Conectar Google"));
    }
    botoes.append(el("button", { class: "btn btn-sm " + (calOk || gmailOk ? "btn-primary" : "btn-ghost"), disabled: gerando || (!calOk && !gmailOk) ? "" : null, onclick: gerar }, r ? "↻ Atualizar" : "Montar resumo"));
    bar.append(botoes);
    main.append(head, bar);

    // ---- aviso das 8h ----
    main.append(cardAviso());

    // ---- corpo do resumo ----
    if (!r) {
      main.append(el("div", { class: "empty" }, (calOk || gmailOk)
        ? "Toque em “Montar resumo” para gerar o de hoje."
        : "Conecte sua Agenda e seu Gmail para montar o resumo do dia."));
      return;
    }

    main.append(
      el("div", { class: "t2", style: "margin:2px 0 8px" }, "Gerado às " + new Date(r.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })),
      secaoAgenda("📅 Agenda de hoje", r.hoje, r.calOk, navigate),
      secaoAgenda("📅 Agenda de amanhã", r.amanha, r.calOk, navigate),
      secaoAtencao(r),
      secaoOutros(r),
      el("div", { style: "display:flex; gap:8px; margin-top:10px" }, [
        el("button", { class: "btn btn-ghost btn-sm", onclick: async () => {
          try { await navigator.clipboard.writeText(resumoTexto(r)); toast("Resumo copiado."); }
          catch { toast("Não consegui copiar."); }
        } }, "📋 Copiar resumo"),
      ]),
    );
  };

  async function gerar() {
    if (gerando) return;
    gerando = true; draw();
    try { await gerarResumo(); } catch (e) { toast("Não consegui montar o resumo. " + (e?.message || "")); }
    gerando = false; draw();
  }

  draw();

  // Gera sozinho na primeira abertura do dia (se conectado e sem cache fresco).
  if (!resumoDeHoje() && (gcal.isConnected() || gmail.isConnected())) gerar();
}

// ---- componentes da página ----
function secaoAgenda(titulo, eventos, calOk, navigate) {
  const corpo = eventos.length
    ? el("div", { class: "list" }, eventos.map((e) => el("button", { class: "hoje-item", onclick: () => navigate("agenda") }, [
        el("span", { class: "hoje-item-ic" }, /audi[êe]nc/i.test(e.title || "") ? "⚖️" : "📅"),
        el("span", { class: "hoje-item-body" }, [
          el("span", { class: "hoje-item-tit" }, e.title || "Compromisso"),
          el("span", { class: "hoje-item-sub" }, [horaEv(e), e.location].filter(Boolean).join(" · ")),
        ]),
        el("span", { class: "hoje-item-go" }, "›"),
      ])))
    : el("div", { class: "t2" }, calOk ? "Nada agendado." : "Conecte o Google Agenda para ver.");
  return el("div", { class: "card" }, [el("div", { class: "card-title" }, titulo), corpo]);
}

function motivoPill(m) {
  const cls = { cliente: "alta", tribunal: "media", prazo: "alta" }[m.tipo] || "";
  return el("span", { class: "pill " + cls, style: "margin-left:6px" }, m.texto);
}

function secaoAtencao(r) {
  let corpo;
  if (!r.gmailOk) corpo = el("div", { class: "t2" }, "Conecte o Gmail para ver os e-mails que pedem atenção.");
  else if (!r.atencao.length) corpo = el("div", { class: "t2" }, "Nenhum e-mail urgente nas últimas 24h. ✨");
  else corpo = el("div", { class: "list" }, r.atencao.map((m) => el("a", {
      class: "row resumo-mail", href: m.link, target: "_blank", rel: "noopener",
    }, [
      el("div", { class: "grow" }, [
        el("div", { class: "t1" }, m.fromNome),
        el("div", { class: "t2", style: "white-space:normal" }, m.subject),
        el("div", { style: "margin-top:4px" }, m.motivos.map(motivoPill)),
      ]),
      el("span", { class: "hoje-item-go" }, "↗"),
    ])));
  return el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "📨 E-mails que precisam de atenção" + (r.gmailOk && r.atencao.length ? ` (${r.atencao.length})` : "")),
    corpo,
  ]);
}

function secaoOutros(r) {
  const txt = !r.gmailOk
    ? "Conecte o Gmail para contar os não lidos."
    : plural(r.outros, "e-mail não lido", "e-mails não lidos") + " sem prazo/cliente aparente nas últimas 24h.";
  return el("div", { class: "card" }, [el("div", { class: "card-title" }, "📬 Outros e-mails"), el("div", { class: "t2" }, txt)]);
}

function cardAviso() {
  const suporta = podeNotificar();
  const ligado = notifyOn() && permissaoNotif() === "granted";
  const horaInput = el("input", { type: "time", class: "form-control", style: "max-width:130px", value: horaAviso() });
  horaInput.onchange = () => { localStorage.setItem(HORA_KEY, horaInput.value || "08:00"); localStorage.removeItem(NOTIFIED_KEY); toast("Aviso às " + (horaInput.value || "08:00") + "."); };

  const toggle = el("button", { class: "btn btn-sm " + (ligado ? "btn-ghost" : "btn-primary"), disabled: suporta ? null : "" }, ligado ? "Desativar aviso" : "🔔 Avisar todo dia");
  toggle.onclick = async () => {
    if (ligado) { desativarNotificacoes(); toast("Aviso diário desativado."); }
    else {
      try { await ativarNotificacoes(); toast("🔔 Aviso diário ativado."); }
      catch (e) { toast(e?.message || "Não consegui ativar as notificações."); }
    }
    // redesenha só o card
    const novo = cardAviso();
    card.replaceWith(novo);
  };

  const card = el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "🔔 Aviso diário"),
    el("p", { class: "t2", style: "margin:2px 0 10px" }, suporta
      ? "Com o app instalado e aberto a partir do horário, você recebe uma notificação com o resumo do dia. (Um PWA não roda 100% sozinho em segundo plano — o aviso dispara ao abrir o app na hora marcada.)"
      : "Este navegador não suporta notificações."),
    el("div", { style: "display:flex; gap:10px; align-items:center; flex-wrap:wrap" }, [
      el("label", { class: "t2", style: "display:flex; gap:6px; align-items:center" }, ["Horário", horaInput]),
      toggle,
    ]),
  ]);
  return card;
}
