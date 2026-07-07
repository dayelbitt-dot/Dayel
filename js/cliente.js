// Modelo de dados do CLIENTE (pasta cadastral) — funções puras, sem DOM.
//
// A tela "Dados Cadastrais" deixou de ser texto corrido e passou a ser um objeto
// estruturado (ver README). Para não quebrar nada do que já existe (geração de
// procuração/declaração em docs.js, importação/exportação de planilha, contatos),
// as colunas "planas" antigas (nome, cpf, rg, tel, email, nasc, endereco,
// nacionalidade, estado_civil, profissao) continuam existindo e são MANTIDAS EM
// SINCRONIA: o objeto estruturado vive na coluna jsonb `cadastro`, e a cada
// gravação derivamos de volta as colunas planas com `flatFromCadastro`.
//
// Cadastros antigos (sem `cadastro`) são normalizados a partir das colunas planas
// — abrem já organizados na visão em seções, sem perder informação.

import { prettyDate } from "./ui.js";

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export const CONDICOES = [
  { key: "menor_impubere", label: "Menor impúbere" },
  { key: "menor_pubere", label: "Menor púbere" },
  { key: "incapaz", label: "Incapaz" },
  { key: "interditado", label: "Interditado" },
  { key: "idoso", label: "Idoso" },
];
const CONDICAO_LABEL = Object.fromEntries(CONDICOES.map((c) => [c.key, c.label]));

// Condições que exigem representante legal (idoso, por si só, não exige).
const EXIGEM_REPRESENTANTE = new Set(["menor_impubere", "menor_pubere", "incapaz", "interditado"]);

export const RELACOES_REP = [
  { key: "mae", label: "Mãe" },
  { key: "pai", label: "Pai" },
  { key: "tutor", label: "Tutor" },
  { key: "curador", label: "Curador" },
  { key: "procurador", label: "Procurador" },
];
const RELACAO_LABEL = Object.fromEntries(RELACOES_REP.map((r) => [r.key, r.label]));
export const relacaoLabel = (k) => RELACAO_LABEL[k] || "Representante";

export const TIPOS_DOCUMENTO = [
  { key: "certidao_nascimento", label: "Certidão de nascimento" },
  { key: "certidao_casamento", label: "Certidão de casamento" },
  { key: "cnh", label: "CNH" },
  { key: "rg", label: "RG" },
  { key: "outro", label: "Outro documento" },
];
const DOC_LABEL = Object.fromEntries(TIPOS_DOCUMENTO.map((d) => [d.key, d.label]));
export const docTipoLabel = (k) => DOC_LABEL[k] || "Documento";

// ---------------------------------------------------------------------------
// Máscaras e limpeza (BR)
// ---------------------------------------------------------------------------

export const onlyDigits = (s) => String(s == null ? "" : s).replace(/\D/g, "");

export function maskCPF(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}

export function maskCNPJ(v) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length > 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length > 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 5) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

// Aceita CPF (PF) ou CNPJ (PJ) conforme a quantidade de dígitos.
export function maskCpfCnpj(v, tipoPessoa) {
  if (tipoPessoa === "PJ") return maskCNPJ(v);
  return onlyDigits(v).length > 11 ? maskCNPJ(v) : maskCPF(v);
}

export function maskCEP(v) {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function maskTelefone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Matrícula de certidão: 32 dígitos em blocos 6-2-2-4-1-5-3-7-2.
const MATRICULA_BLOCOS = [6, 2, 2, 4, 1, 5, 3, 7, 2];
export function maskMatricula(v) {
  const d = onlyDigits(v).slice(0, 32);
  const out = [];
  let i = 0;
  for (const b of MATRICULA_BLOCOS) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + b));
    i += b;
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Validações (vazio = válido; a obrigatoriedade é decidida por quem usa)
// ---------------------------------------------------------------------------

export function isValidCPF(v) {
  const cpf = onlyDigits(v);
  if (!cpf) return true;
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === +cpf[10];
}

export function isValidCNPJ(v) {
  const cnpj = onlyDigits(v);
  if (!cnpj) return true;
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len) => {
    let s = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) { s += cnpj[len - i] * pos--; if (pos < 2) pos = 9; }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calc(12) !== +cnpj[12]) return false;
  return calc(13) === +cnpj[13];
}

export function isValidCpfCnpj(v, tipoPessoa) {
  return tipoPessoa === "PJ" ? isValidCNPJ(v) : isValidCPF(v);
}

export function isValidCEP(v) {
  const d = onlyDigits(v);
  return d === "" || d.length === 8;
}

export function isValidTelefone(v) {
  const d = onlyDigits(v);
  return d === "" || (d.length >= 10 && d.length <= 11);
}

// ---------------------------------------------------------------------------
// Normalização: sempre devolve um objeto estruturado COMPLETO.
// ---------------------------------------------------------------------------

const obj = (x) => (x && typeof x === "object" && !Array.isArray(x)) ? x : {};
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (x == null ? "" : String(x));

function normEndereco(e) {
  const s = obj(e);
  return {
    logradouro: str(s.logradouro), numero: str(s.numero), complemento: str(s.complemento),
    bairro: str(s.bairro), cidade: str(s.cidade), uf: str(s.uf), cep: str(s.cep),
  };
}

function normPessoa(p) {
  const s = obj(p);
  return {
    nomeCompleto: str(s.nomeCompleto),
    cpf: str(s.cpf),
    documentoIdentidade: {
      numero: str(obj(s.documentoIdentidade).numero),
      orgaoEmissor: str(obj(s.documentoIdentidade).orgaoEmissor),
      uf: str(obj(s.documentoIdentidade).uf),
    },
    dataNascimento: str(s.dataNascimento),
    nacionalidade: str(s.nacionalidade),
    estadoCivil: str(s.estadoCivil),
    profissao: str(s.profissao),
    filiacao: { pai: str(obj(s.filiacao).pai), mae: str(obj(s.filiacao).mae) },
    contato: {
      telefone: str(obj(s.contato).telefone),
      celular: str(obj(s.contato).celular),
      email: str(obj(s.contato).email),
    },
    endereco: normEndereco(s.endereco),
  };
}

export function normRepresentante(r) {
  const s = obj(r);
  return {
    relacao: str(s.relacao) || "mae",
    tipoRepresentacao: str(s.tipoRepresentacao) || "legal",
    mesmoEndereco: !!s.mesmoEndereco,
    ...normPessoa(s),
  };
}

export function normDocumento(d) {
  const s = obj(d);
  return {
    tipo: str(s.tipo) || "certidao_nascimento",
    matricula: str(s.matricula),
    matriculaLimpa: str(s.matriculaLimpa) || onlyDigits(s.matricula),
    livro: str(s.livro), folha: str(s.folha), termo: str(s.termo),
    serventia: str(s.serventia), comarca: str(s.comarca),
    dataRegistro: str(s.dataRegistro), anexoRef: str(s.anexoRef),
  };
}

// Recebe a linha do cliente (colunas planas + coluna `cadastro`) e devolve o
// objeto estruturado completo, preferindo `cadastro` e caindo para as colunas
// planas quando o campo estruturado estiver vazio (cadastros antigos).
export function normalizeCadastro(c = {}) {
  const cad = obj(c.cadastro);
  const di = obj(cad.documentoIdentidade);
  const co = obj(cad.contato);
  const endEstruturado = obj(cad.endereco);
  const temEnderecoEstruturado = Object.values(endEstruturado).some((v) => str(v).trim());
  const legacyEndereco = str(c.endereco).trim();

  return {
    tipoPessoa: cad.tipoPessoa === "PJ" ? "PJ" : "PF",
    status: cad.status === "inativo" ? "inativo" : "ativo",
    nomeCompleto: str(cad.nomeCompleto) || str(c.nome),
    nomeSocial: str(cad.nomeSocial),
    cpf: str(cad.cpf) || str(c.cpf),
    documentoIdentidade: {
      numero: str(di.numero) || str(c.rg),
      orgaoEmissor: str(di.orgaoEmissor),
      uf: str(di.uf),
    },
    dataNascimento: str(cad.dataNascimento) || str(c.nasc).slice(0, 10),
    localNascimento: { cidade: str(obj(cad.localNascimento).cidade), uf: str(obj(cad.localNascimento).uf) },
    nacionalidade: str(cad.nacionalidade) || str(c.nacionalidade),
    estadoCivil: str(cad.estadoCivil) || str(c.estado_civil),
    regimeBens: str(cad.regimeBens),
    profissao: str(cad.profissao) || str(c.profissao),
    filiacao: { pai: str(obj(cad.filiacao).pai), mae: str(obj(cad.filiacao).mae) },
    contato: {
      telefone: str(co.telefone),
      celular: str(co.celular) || str(c.tel),
      email: str(co.email) || str(c.email),
    },
    endereco: temEnderecoEstruturado
      ? normEndereco(endEstruturado)
      : { ...normEndereco({}), logradouro: legacyEndereco },
    condicoesEspeciais: arr(cad.condicoesEspeciais).filter((k) => CONDICAO_LABEL[k]),
    representantes: arr(cad.representantes).map(normRepresentante),
    documentos: arr(cad.documentos).map(normDocumento),
    tags: arr(cad.tags).map(str).filter(Boolean),
    // campos "planos" que não fazem parte do objeto estruturado mas seguem no CRM
    area: str(c.area),
    origem: str(c.origem),
  };
}

// ---------------------------------------------------------------------------
// Derivação de volta para as colunas planas (mantém docs/planilha funcionando).
// ---------------------------------------------------------------------------

export function flatFromCadastro(cad) {
  return {
    nome: str(cad.nomeCompleto).trim(),
    cpf: str(cad.cpf).trim(),
    rg: str(cad.documentoIdentidade?.numero).trim(),
    tel: (str(cad.contato?.celular).trim() || str(cad.contato?.telefone).trim()),
    email: str(cad.contato?.email).trim(),
    nasc: str(cad.dataNascimento).slice(0, 10) || null,
    endereco: formatEndereco(cad.endereco),
    nacionalidade: str(cad.nacionalidade).trim(),
    estado_civil: str(cad.estadoCivil).trim(),
    profissao: str(cad.profissao).trim(),
  };
}

// ---------------------------------------------------------------------------
// Formatação e qualificação jurídica
// ---------------------------------------------------------------------------

export const condicaoLabel = (k) => CONDICAO_LABEL[k] || "";

export function exigeRepresentante(cad) {
  return (cad.condicoesEspeciais || []).some((k) => EXIGEM_REPRESENTANTE.has(k));
}

export function precisaAvisoRepresentante(cad) {
  return exigeRepresentante(cad) && !(cad.representantes || []).length;
}

// Endereço estruturado -> texto no padrão de peça.
export function formatEndereco(e) {
  if (!e) return "";
  if (typeof e === "string") return e.trim();
  const linha1 = [
    str(e.logradouro).trim(),
    str(e.numero).trim() ? `nº ${str(e.numero).trim()}` : "",
    str(e.complemento).trim(),
  ].filter(Boolean).join(", ");
  const parts = [];
  if (linha1) parts.push(linha1);
  if (str(e.bairro).trim()) parts.push(`Bairro ${str(e.bairro).trim()}`);
  if (str(e.cep).trim()) parts.push(`CEP ${str(e.cep).trim()}`);
  const cidadeUf = [str(e.cidade).trim(), str(e.uf).trim()].filter(Boolean).join("/");
  if (cidadeUf) parts.push(cidadeUf);
  return parts.join(", ");
}

// Inferência de gênero pela terminação de nacionalidade / estado civil.
function ehFeminino(p) {
  for (const w of [p.nacionalidade, p.estadoCivil]) {
    const t = String(w || "").trim().toLowerCase();
    if (/a$/.test(t)) return true;
    if (/o$/.test(t)) return false;
  }
  return false;
}

function flexoes(p) {
  const fem = ehFeminino(p);
  return {
    fem,
    nasc: fem ? "nascida" : "nascido",
    inscr: fem ? "inscrita" : "inscrito",
    port: fem ? "portadora" : "portador",
    res: fem ? "residente e domiciliada" : "residente e domiciliado",
    repd: fem ? "representada" : "representado",
  };
}

// Qualificação de uma pessoa (cliente ou representante), começando pelo nome.
function qualificaPessoa(p, { condicoes = [], enderecoTexto } = {}) {
  const g = flexoes(p);
  const nome = String(p.nomeCompleto || "").trim().toUpperCase();
  const condLabels = condicoes.map((k) => condicaoLabel(k).toLowerCase()).filter(Boolean);
  const bits = [
    ...condLabels,
    String(p.nacionalidade || "").trim(),
    String(p.estadoCivil || "").trim(),
    String(p.profissao || "").trim(),
  ].filter(Boolean);

  let s = nome;
  if (bits.length) s += ", " + bits.join(", ");
  if (String(p.dataNascimento || "").trim()) s += `, ${g.nasc} em ${prettyDate(p.dataNascimento)}`;
  if (String(p.cpf || "").trim()) s += `, ${g.inscr} no CPF sob nº ${String(p.cpf).trim()}`;
  const doc = p.documentoIdentidade || {};
  if (String(doc.numero || "").trim()) {
    const org = [doc.orgaoEmissor, doc.uf].map((x) => String(x || "").trim()).filter(Boolean).join("/");
    s += `, ${g.port} do documento de identidade nº ${String(doc.numero).trim()}${org ? ` (${org})` : ""}`;
  }
  const endStr = enderecoTexto != null ? enderecoTexto : formatEndereco(p.endereco);
  if (endStr) s += `, ${g.res} na ${endStr}`;
  return s;
}

// "sua genitora" / "seu genitor" / "seu tutor"… conforme relação e gênero.
function tratamentoRepresentante(rep) {
  const fem = ehFeminino(rep);
  switch (rep.relacao) {
    case "mae": return "sua genitora";
    case "pai": return "seu genitor";
    case "tutor": return fem ? "sua tutora" : "seu tutor";
    case "curador": return fem ? "sua curadora" : "seu curador";
    case "procurador": return fem ? "sua procuradora" : "seu procurador";
    default: return fem ? "sua representante" : "seu representante";
  }
}

// Texto de qualificação pronto para colar em petição.
// comRepresentante: acrescenta "neste ato representada por sua genitora …".
export function qualificacao(cad, { comRepresentante = false } = {}) {
  const g = flexoes(cad);
  let s = qualificaPessoa(cad, { condicoes: cad.condicoesEspeciais || [] });

  if (comRepresentante) {
    const rep = (cad.representantes || [])[0];
    if (rep) {
      const enderecoRep = rep.mesmoEndereco ? "no mesmo endereço acima" : undefined;
      const repQualif = qualificaPessoa(rep, enderecoRep ? { enderecoTexto: "" } : {});
      const trat = tratamentoRepresentante(rep);
      s += `, neste ato ${g.repd} por ${trat} ${repQualif}`;
      if (enderecoRep) s += `, ${ehFeminino(rep) ? "residente e domiciliada" : "residente e domiciliado"} ${enderecoRep}`;
    }
  }
  return s.replace(/\s+/g, " ").trim() + ".";
}

// Duas versões (cliente sozinho / cliente + representante) para o botão "Copiar".
export function qualificacoes(cad) {
  const temRep = (cad.representantes || []).length > 0;
  return {
    cliente: qualificacao(cad, { comRepresentante: false }),
    comRepresentante: temRep ? qualificacao(cad, { comRepresentante: true }) : null,
  };
}
