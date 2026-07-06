// Pequenos utilitários de interface e formatação.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// Converte qualquer valor em texto legível. Se vier um objeto/array (ex.: a IA
// devolveu "partes" como {autor,reu} em vez de string), achata em texto em vez
// de virar "[object Object]". Também limpa "[object Object]" já salvo por engano.
export function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/\[object Object\]/g, "").trim();
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.values(v).map(asText).filter(Boolean).join(", ");
  return String(v);
}

export const BRL = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function monthKey(iso) { return (iso || todayISO()).slice(0, 7); }

export function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function monthLabel(key) {
  const [y, m] = key.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[Number(m) - 1]}/${y}`;
}

// ---- Modal ----
export function openModal(node) {
  const backdrop = $("#modal-backdrop");
  const modal = $("#modal");
  modal.innerHTML = "";
  modal.append(node);
  backdrop.classList.remove("hidden");
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
}
export function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
}

// ---- Toast (aviso com ação opcional) ----
let toastTimer = null;
export function toast(message, { action, duration = 5000 } = {}) {
  let host = $("#toast-host");
  if (!host) {
    host = el("div", { id: "toast-host", class: "toast-host" });
    document.body.append(host);
  }
  host.innerHTML = "";
  clearTimeout(toastTimer);
  const t = el("div", { class: "toast" }, [
    el("span", { class: "toast-msg" }, message),
    action ? el("button", { class: "toast-action", onclick: () => { clearTimeout(toastTimer); host.innerHTML = ""; action.onClick(); } }, action.label) : null,
    el("button", { class: "toast-close", onclick: () => { clearTimeout(toastTimer); host.innerHTML = ""; } }, "×"),
  ]);
  host.append(t);
  toastTimer = setTimeout(() => { host.innerHTML = ""; }, duration);
}

// ---- Donut chart em SVG ----
export function donut(data, size = 130) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 12, C = 2 * Math.PI * r;
  let offset = 0;
  if (total === 0) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r);
    circle.setAttribute("fill", "none"); circle.setAttribute("stroke", "#26365c"); circle.setAttribute("stroke-width", 16);
    svg.append(circle);
    return svg;
  }
  for (const d of data) {
    const frac = d.value / total;
    const arc = document.createElementNS(svg.namespaceURI, "circle");
    arc.setAttribute("cx", cx); arc.setAttribute("cy", cy); arc.setAttribute("r", r);
    arc.setAttribute("fill", "none"); arc.setAttribute("stroke", d.color); arc.setAttribute("stroke-width", 16);
    arc.setAttribute("stroke-dasharray", `${frac * C} ${C}`);
    arc.setAttribute("stroke-dashoffset", -offset * C);
    arc.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
    svg.append(arc);
    offset += frac;
  }
  return svg;
}

export const PALETTE = ["#5b8cff", "#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#22d3ee"];
