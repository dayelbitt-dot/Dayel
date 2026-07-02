// Interpretador de linguagem natural (pt-BR).
// Recebe um texto livre e extrai: título, área, prioridade e prazo.

function ymd(d) {
  const o = d.getTimezoneOffset();
  return new Date(d.getTime() - o * 60000).toISOString().slice(0, 10);
}

const WEEKDAYS = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
};

// remove acentos só para comparação de palavras-chave
const noAccent = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function parseNaturalTask(input, defaultArea = "pessoal") {
  const original = (input || "").trim().replace(/\s+/g, " ");
  if (!original) return null;

  let text = original;                 // vamos removendo os trechos reconhecidos
  const low = () => noAccent(text.toLowerCase());

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

  let due = null;
  let priority = "media";
  let area = defaultArea;

  // apaga (case-insensitive) o primeiro trecho que casar com a regex
  function strip(re) {
    text = text.replace(re, " ").replace(/\s+/g, " ").trim();
  }

  // ---------- PRIORIDADE ----------
  if (/\b(urgent\w*|asap|o quanto antes|o mais r[aá]pido|priorid\w*\s+alta|import\w+)\b/i.test(text)) {
    priority = "alta";
    strip(/\b(urgent\w*|asap|o quanto antes|o mais r[aá]pido poss[ií]vel|o mais r[aá]pido|priorid\w*\s+alta|import\w+)\b/i);
  } else if (/\b(sem pressa|quando puder|quando der|pode esperar|baixa priorid\w*|priorid\w*\s+baixa|tranquilo)\b/i.test(text)) {
    priority = "baixa";
    strip(/\b(sem pressa|quando puder|quando der|pode esperar|baixa priorid\w*|priorid\w*\s+baixa|tranquilo)\b/i);
  }

  // ---------- ÁREA ----------
  const workRe = /\b(trabalh\w*|reuni[aã]o|cliente|relat[oó]rio|proposta|projeto|chefe|empresa|escrit[oó]rio|e-?mail|apresenta[cç][aã]o|deadline|entrega|contrato|fatura|or[cç]amento|planilha|colega|gerente|equipe|call)\b/i;
  if (/\bprofissional\b/i.test(text)) { area = "profissional"; strip(/\b(no\s+)?profissional\b/i); }
  else if (/\bno trabalho\b|\bde trabalho\b|\bdo trabalho\b/i.test(text)) { area = "profissional"; strip(/\b(no|de|do) trabalho\b/i); }
  else if (/\bpessoal\b/i.test(text)) { area = "pessoal"; strip(/\b(no\s+)?pessoal\b/i); }
  else if (workRe.test(text)) { area = "profissional"; } // palavra fica no título

  // ---------- PRAZO (ordem importa: do mais específico ao mais genérico) ----------
  // Casamos sobre low() (sem acento, mesmos índices que `text`) e recortamos
  // por índice — assim evitamos o problema de \b após vogais acentuadas (ã).
  const setAt = (d, m) => {
    if (due || !m) return;
    due = ymd(d);
    text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length))
      .replace(/\s+/g, " ").trim();
  };
  let m;

  // dd/mm ou dd/mm/aaaa
  if (!due && (m = low().match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const dd = +m[1], mm = +m[2] - 1;
    let yy = m[3] ? +m[3] : today.getFullYear();
    if (yy < 100) yy += 2000;
    const d = new Date(yy, mm, dd); d.setHours(0, 0, 0, 0);
    if (!m[3] && d < today) d.setFullYear(yy + 1);
    if (!isNaN(d)) setAt(d, m);
  }

  // depois de amanhã (antes de "amanhã") / hoje / amanhã
  if (!due && (m = low().match(/\bdepois de amanha\b/))) setAt(addDays(2), m);
  if (!due && (m = low().match(/\bhoje\b/))) setAt(addDays(0), m);
  if (!due && (m = low().match(/\bamanha\b/))) setAt(addDays(1), m);

  // em / daqui a N dias|semanas
  if (!due && (m = low().match(/\b(?:em|daqui a|daqui)\s+(\d+)\s+(dias?|semanas?)\b/))) {
    const n = +m[1];
    setAt(addDays(/semana/.test(m[2]) ? n * 7 : n), m);
  }

  // semana que vem / próxima semana
  if (!due && (m = low().match(/\b(?:na\s+)?(?:semana que vem|proxima semana)\b/))) {
    setAt(addDays(7), m);
  }

  // dia da semana (com ou sem "próxima / que vem")
  if (!due && (m = low().match(
    /\b(?:(?:na|nesta|nessa|essa|neste)\s+)?(proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?(\s+que vem)?\b/
  ))) {
    const modifier = !!m[1] || !!m[3];
    const target = WEEKDAYS[m[2]];
    let ahead = (target - today.getDay() + 7) % 7;
    if (ahead === 0) ahead = 7; // "segunda" dita numa segunda = próxima segunda
    if (modifier) {
      const untilSunday = (7 - today.getDay()) % 7; // dias até o domingo (fim da semana)
      if (ahead <= untilSunday || untilSunday === 0) ahead += 7; // joga para a semana seguinte
    }
    setAt(addDays(ahead), m);
  }

  // dia N (do mês)
  if (!due && (m = low().match(/\bdia\s+(\d{1,2})\b/))) {
    const dd = +m[1];
    if (dd >= 1 && dd <= 31) {
      let d = new Date(today.getFullYear(), today.getMonth(), dd); d.setHours(0, 0, 0, 0);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, dd);
      setAt(d, m);
    }
  }

  // ---------- LIMPEZA DO TÍTULO ----------
  let title = text
    .replace(/^[\s,.;:–-]+/, "")
    .replace(/[\s,.;:–-]+$/, "")
    .replace(/\b(preciso|tenho que|tenho de|lembrar de|lembrete|me lembra de|anotar)\s+/i, "")
    .replace(/^(de|do|da|para|pra|no|na)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) title = original; // se sobrou vazio, usa o texto original
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title, area, priority, due_date: due };
}
