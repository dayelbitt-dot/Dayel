# ✦ Meu Assistente

Assistente **pessoal e profissional** para organizar toda a sua vida — em um único app que roda no **celular e no computador** (qualquer aparelho com navegador).

É um **PWA**: você abre pelo link e pode "instalar" na tela inicial como se fosse um app de loja. Não precisa de Play Store nem App Store.

## O que já tem

- ✨ **Captura rápida** — descreva a tarefa em linguagem natural e o sistema cadastra sozinho
- 🏠 **Início** — painel com resumo das tarefas do dia, pendências e notas recentes
- 🧑 **Pessoal** — tarefas, prioridades e prazos
- 💼 **Trabalho** — tarefas profissionais separadas das pessoais
- 📝 **Notas** — anotações rápidas

### ✨ Captura rápida (texto, voz e arquivos)

No topo do **Início** há uma caixa onde você pode:

- **Escrever** em linguagem natural — ex: *"ligar para o cliente amanhã de manhã, urgente"*
- **Falar** (🎤) — grava o áudio e transcreve para texto (reconhecimento de voz do navegador, em português)
- **Subir um arquivo** (📎) — o sistema extrai o texto e preenche a caixa:
  - `.txt`, `.md`, `.csv` — leitura direta (funciona offline)
  - **PDF** com texto — extraído com pdf.js
  - **Imagem / foto / print** — texto reconhecido por OCR (Tesseract.js, em português)

O interpretador entende automaticamente:

| O que reconhece | Exemplos |
|-----------------|----------|
| **Prazo** | "hoje", "amanhã", "depois de amanhã", "sexta que vem", "em 3 dias", "dia 15", "10/07" |
| **Prioridade** | "urgente", "importante" → Alta · "sem pressa", "quando puder" → Baixa |
| **Área** | palavras como "reunião", "cliente", "relatório", "chefe" → Trabalho; senão Pessoal |

Antes de salvar, um **preview ao vivo** mostra o que foi entendido; depois de cadastrar, aparece um aviso com botão **Desfazer**.

> Voz, digitação e arquivos de texto funcionam offline. A leitura de **PDF** e **imagem (OCR)** baixa a biblioteca de uma CDN pública na primeira vez (precisa de internet).

Funciona em **dois modos**:

| Modo | Como funciona | Quando usar |
|------|---------------|-------------|
| **Local** (padrão) | Dados salvos só neste aparelho | Testar rápido, sem configurar nada |
| **Nuvem** (Supabase) | Login + mesmos dados no celular e no PC | Uso de verdade, em vários aparelhos |

---

## 🚀 Como ligar a nuvem (login em vários aparelhos)

É grátis e leva ~5 minutos.

### 1. Criar o projeto no Supabase
1. Acesse **https://supabase.com** e crie uma conta (pode usar o Google).
2. Clique em **New project**, dê um nome (ex: `assistente`) e escolha uma senha.
3. Espere ~1 minuto até o projeto ficar pronto.

### 2. Criar as tabelas
1. No menu lateral, abra **SQL Editor**.
2. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste projeto, copie **todo** o conteúdo.
3. Cole no SQL Editor e clique em **Run**. Pronto — as tabelas foram criadas.

### 3. Pegar os 2 códigos
1. No menu, vá em **Project Settings → API**.
2. Copie:
   - **Project URL** (algo como `https://xxxx.supabase.co`)
   - **anon public** key (uma chave longa)

### 4. Colar no app
Abra [`js/config.js`](js/config.js) e preencha:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "sua-chave-anon-aqui";
```

Salve, e pronto: o app passa a pedir login e sincronizar entre aparelhos. ✅

> As chaves `anon` são **públicas por natureza** — a segurança vem das políticas de acesso (Row Level Security) já incluídas no `schema.sql`, que garantem que cada usuário só enxerga os próprios dados.

---

## 📲 Como usar no celular

Depois de publicado (ex: GitHub Pages), abra o link no navegador do celular:
- **Android (Chrome):** menu ⋮ → *Adicionar à tela inicial*
- **iPhone (Safari):** botão compartilhar → *Adicionar à Tela de Início*

O app abre em tela cheia, como um app normal.

---

## 🛠️ Rodar localmente (para desenvolver)

Como usa módulos ES, sirva por um servidor local (não abra o arquivo direto):

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Estrutura

```
index.html              # estrutura das telas
css/styles.css          # visual
js/config.js            # onde você cola as chaves do Supabase
js/store.js             # dados (nuvem ou local)
js/auth.js              # login
js/ui.js                # utilitários e gráfico
js/app.js               # telas e navegação
supabase/schema.sql     # banco de dados
manifest.webmanifest    # configuração do PWA
sw.js                   # funcionar offline
```
