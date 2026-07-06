# ✦ Meu Assistente

Assistente **pessoal e profissional** para organizar toda a sua vida — em um único app que roda no **celular e no computador** (qualquer aparelho com navegador).

É um **PWA**: você abre pelo link e pode "instalar" na tela inicial como se fosse um app de loja. Não precisa de Play Store nem App Store.

## O que já tem

- ✨ **Captura rápida multi-tipo** — escreva/fale/suba documentos, escolha **um ou vários destinos** (Tarefa, Agenda, Nota, Cliente, Processo) e o sistema cadastra tudo de uma vez
- 🏠 **Início** — painel com resumo das tarefas do dia, pendências, lembretes e notas
- 🧑 **Pessoal** — tarefas, prioridades e prazos
- 💼 **Trabalho** — tarefas profissionais separadas das pessoais
- 🔔 **Lembretes gerais** — tudo que você precisa lembrar, organizado por data (ordem cronológica), agrupado em Atrasados · Hoje · Próximos 7 dias · Mais adiante · Sem data
- 📄 **Gerar Documentos** — cria **procuração** (judicial/extrajudicial) e **declaração de hipossuficiência** no seu modelo (mesma fonte e formatação), preenchendo com os dados da parte (de um cliente, de documentos anexados ou digitados) e baixa o `.docx`
- 📬 **Publicações oficiais** — busca no seu **Gmail** os e-mails de *Movimentações Processuais – EPROC* e monta uma **tabela** com o teor de cada publicação (processo, órgão/vara, classe, evento, prazo, partes e o teor completo)
- 📝 **Notas** — anotações rápidas

Visual em **tema claro**, otimizado para celular e computador.

### ✨ Captura rápida (texto, voz, arquivos e vários destinos)

No topo do **Início** há uma caixa onde você pode:

- **Escrever** em linguagem natural — ex: *"ligar para o cliente amanhã de manhã, urgente"*
- **Falar** (🎤) — grava o áudio e transcreve para texto (reconhecimento de voz do navegador, em português)
- **Subir arquivos** (📎) — o arquivo **fica anexado** ao registro (não é despejado
  na caixa de texto). O sistema **lê o conteúdo** por baixo dos panos e usa para
  preencher os cadastros:
  - `.txt`, `.md`, `.csv` — leitura direta (funciona offline)
  - **PDF** com texto — extraído com pdf.js
  - **Imagem / foto / print** — texto reconhecido por OCR (Tesseract.js, em português)

> 📎➡️👤 **Anexe e mande cadastrar:** anexe uma **petição** (ou ficha, contrato…) e
> escreva a instrução — ex.: *"cadastre o cliente"* ou *"cadastre o cliente João da
> Silva"*. O app marca sozinho o destino, **puxa os dados da pessoa do documento**
> (nome, CPF, RG, endereço…) e cria o cadastro. Diga *"cadastre o processo"* e ele
> lê os dados do processo e **já vincula ao cliente correspondente já cadastrado**.
>
> 👥 **Várias partes de uma vez:** *"cadastre as duas partes"* / *"cadastre os
> clientes Saher e Cláudia"* / *"cadastre todas as partes"* cria **um cadastro por
> parte** e **vincula o mesmo processo a todas** (litisconsórcio, divórcio
> consensual). Seu cliente pode ser o **réu**: diga *"cadastre o réu"* / *"cadastre
> a requerida"*, ou nomeie a pessoa (o app procura nos dois lados do processo).

> 💾 **Rascunho automático:** o que você escreve, dita ou anexa fica **salvo neste aparelho** enquanto você não gera nem cancela. Pode sair da tela, fechar o app ou o navegador e, ao voltar, **continua de onde parou** — inclusive os destinos que já tinha marcado.

**Escolha para onde vai** (pode marcar mais de um ao mesmo tempo):

| Destino | O que cria |
|---------|------------|
| ✅ **Tarefa** | Uma tarefa pessoal ou de trabalho, com prazo/prioridade |
| 🗓️ **Agenda** | Um compromisso com data/hora (opcionalmente também no Google Agenda) |
| 📝 **Nota** | Uma anotação |
| 👤 **Cliente** | Cadastro completo do cliente (nome, CPF/CNPJ, RG, telefone, e-mail, nascimento, endereço…) |
| ⚖️ **Processo** | Cadastro completo do processo (nº CNJ, tipo, vara, tribunal, partes, valor, fase, grau…) |

**Cadastro automático a partir de documentos:** suba a ficha do cliente e/ou do
processo (PDF, foto ou texto), marque **👤 Cliente** e **⚖️ Processo** juntos e o
app **lê os dados dos documentos**, preenche os dois cadastros e **vincula o
processo ao cliente novo** — tudo de uma vez. Cada campo detectado já vem
preenchido num cartão editável, então você confere e ajusta antes de gerar.

O interpretador entende automaticamente:

| O que reconhece | Exemplos |
|-----------------|----------|
| **Prazo** | "hoje", "amanhã", "depois de amanhã", "sexta que vem", "em 3 dias", "dia 15", "10/07" |
| **Prioridade** | "urgente", "importante" → Alta · "sem pressa", "quando puder" → Baixa |
| **Área** | palavras como "reunião", "cliente", "relatório", "chefe" → Trabalho; senão Pessoal |
| **Dados do cliente** | rótulos como "Nome:", "CPF:", "RG:", "Telefone:", "E-mail:", "Endereço:", "Nascimento:" |
| **Dados do processo** | número CNJ, "Classe/Tipo:", "Vara:", "Comarca:", "Tribunal:", "Réu:", "Valor da causa:", "Distribuição:" |

Antes de salvar, **cartões editáveis** mostram o que foi entendido em cada
destino; depois de cadastrar, aparece um aviso com botão **Desfazer** (que remove
todos os registros criados naquela captura).

> A leitura de documentos é feita **no próprio navegador** (heurísticas em
> português, sem enviar nada para servidores de IA), na mesma linha do resto do
> app. Os documentos anexados ficam guardados junto do cadastro (até 8 MB cada).

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

## 🤖 Leitura de documentos por IA (opcional, recomendado p/ petições)

Sem isso, o app já lê documentos por **regras** (bom para fichas organizadas). Para
ler **petições e documentos livres muito melhor** (nome, CPF, RG, endereço,
requerente × requerido, dados do processo), ligue a leitura por **IA**. A chave da
API fica **só no servidor** (nunca no navegador), então é seguro mesmo com o
repositório público.

1. Tenha uma chave da **Anthropic** (Claude) — `https://console.anthropic.com`.
2. Instale a [CLI do Supabase](https://supabase.com/docs/guides/cli) e faça login (`supabase login`), depois `supabase link` no seu projeto.
3. Publique a função e guarde a chave (uma vez):
   ```bash
   supabase functions deploy extrair
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-sua-chave
   # opcional (mais preciso, um pouco mais caro):
   # supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
   ```
4. Pronto. Na **Captura rápida**, ao anexar um documento aparece “🤖 Lendo o documento com IA…”. Se a função não estiver instalada, o app volta sozinho para a leitura por regras — nada quebra.

> Custa **centavos por documento** (modelo `claude-haiku` por padrão). A função está em [`supabase/functions/extrair/index.ts`](supabase/functions/extrair/index.ts).

---

## 📬 Publicações oficiais (EPROC, direto do seu Gmail)

A aba **Publicações oficiais** busca no seu **Gmail** os e-mails de
**Movimentações Processuais – EPROC** (intimações/publicações eletrônicas) e monta
uma **tabela** com o teor de cada publicação: **data, número do processo (CNJ),
órgão/vara, classe, evento/movimento, prazo, partes** e o **teor completo** (em
“Ver teor”). Tudo é lido **no próprio navegador**, em modo **somente leitura** — nada
é enviado para servidores de IA.

Cada publicação é **vinculada automaticamente** ao **processo** e ao(s)
**cliente(s)** já cadastrados:

1. **Pelo número do processo (CNJ)** — preciso; funciona mesmo com formatação
   (pontos/traços) diferente entre o e-mail e o cadastro.
2. **Pelo nome das partes** (quando o CNJ não bate com nenhum processo) — o app
   procura seus clientes citados nas partes/assunto/teor. Esse vínculo vem marcado
   com **“por nome”** para você conferir. Se o cliente tiver **mais de um
   processo**, ele vincula só o cliente (você escolhe o processo na pasta dele).

Na tabela, a coluna **“Cliente / Processo”** mostra o vínculo e leva direto à pasta
do processo (ou do cliente); em **“Ver teor”** há botões para **abrir o processo**,
**abrir o cliente** e **lançar a publicação como andamento** na linha do tempo do
processo (sem duplicar).

1. Abra a aba **Publicações oficiais** e toque em **🔗 Conectar Gmail** (usa o mesmo
   login do Google do Agenda).
2. O app busca sozinho e mostra a tabela. Use **↻ Atualizar** para rebuscar e o campo
   de filtro para refinar a busca do Gmail (ex.: `eproc "movimentações processuais"`).

> Depois de conectar uma vez, o Gmail é **reconectado sozinho** em segundo plano —
> você não precisa clicar em “Conectar” de novo.

### ⚙️ Habilitar o acesso ao Gmail (uma vez, no Google Cloud)

Como esta aba usa o **mesmo** `GOOGLE_CLIENT_ID` do Google Agenda, no projeto do
Google Cloud desse Client ID você precisa:

1. **Ativar a Gmail API** — em *APIs & Services → Library*, procure **Gmail API** e
   clique em **Enable**.
2. **Liberar o escopo de leitura** — na *OAuth consent screen*, adicione o escopo
   `https://www.googleapis.com/auth/gmail.readonly` (leitura de e-mails).

Se faltar algum desses, o app avisa (“Gmail sem permissão…”) e o resto continua
funcionando normalmente.

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
js/capture.js           # captura rápida multi-tipo (Tarefa/Agenda/Nota/Cliente/Processo)
js/nlp.js               # interpretador de linguagem natural (prazo, prioridade, área)
js/extract.js           # extração de dados de cliente/processo por REGRAS (pt-BR)
js/ai.js                # leitura de documentos por IA (opcional, via função do Supabase)
js/files.js             # extrai texto de PDF/imagem (OCR)/txt
js/gcal.js              # integração com o Google Agenda
js/gmail.js             # busca e-mails do EPROC no Gmail (Publicações oficiais)
js/app.js               # telas e navegação
supabase/schema.sql     # banco de dados
supabase/functions/extrair/  # função de IA (chave da API fica no servidor)
manifest.webmanifest    # configuração do PWA
sw.js                   # funcionar offline
```
