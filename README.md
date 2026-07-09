# ✦ Meu Assistente

Assistente **pessoal e profissional** para organizar toda a sua vida — em um único app que roda no **celular e no computador** (qualquer aparelho com navegador).

É um **PWA**: você abre pelo link e pode "instalar" na tela inicial como se fosse um app de loja. Não precisa de Play Store nem App Store.

## O que já tem

- 🏠 **Início com IA no centro** — a tela inicial é uma **conversa com o assistente** (estilo Claude/ChatGPT): saudação pelo horário, caixa para escrever/falar/anexar em linguagem natural (*“crie uma tarefa para amanhã às 14h”*, *“abra o processo 5001234”*, *“cadastre este cliente”*), **sugestões inteligentes** do dia e o painel **Hoje** com cartões clicáveis (tarefas, prazos, compromissos, audiências, publicações, aniversários). Todo o resto do sistema fica no **menu lateral (☰ Menu)** — nada foi removido
- ☀️ **Resumo do dia** — briefing automático de todo dia, em português, cruzando **Agenda** (hoje e amanhã) e **Gmail** (não lidos das últimas 24h): destaca **e-mails que pedem atenção** (clientes, tribunais/cartórios, possíveis prazos) e conta o resto. Aparece no **Início** e no menu ☰ → *Resumo do dia*, com **aviso opcional às 8h**
- ✨ **Captura rápida multi-tipo** — escreva/fale/suba documentos, escolha **um ou vários destinos** (Tarefa, Agenda, Nota, Cliente, Processo) e o sistema cadastra tudo de uma vez (no menu ☰ → *Captura rápida*)
- 🧑 **Pessoal** — tarefas, prioridades e prazos
- 💼 **Trabalho** — tarefas profissionais separadas das pessoais
- 🔔 **Lembretes gerais** — tudo que você precisa lembrar, organizado por data (ordem cronológica), agrupado em Atrasados · Hoje · Próximos 7 dias · Mais adiante · Sem data
- 📄 **Gerar Documentos** — cria **procuração** (judicial/extrajudicial) e **declaração de hipossuficiência** no seu modelo (mesma fonte e formatação), preenchendo com os dados da parte (de um cliente, de documentos anexados ou digitados) e baixa o `.docx`
- 📬 **Publicações oficiais** — busca no seu **Gmail** os e-mails de *Movimentações Processuais – EPROC* e monta uma **tabela** com o teor de cada publicação (processo, órgão/vara, classe, evento, prazo, partes e o teor completo)
- ⏰ **Importar prazos (Excel do tribunal)** — na aba **Processos**, botão *⬆ Importar prazos*: suba o `.xls/.xlsx` de prazos em aberto (EPROC) e o app **cria as tarefas de prazo** (vencimento = *Final Prazo*, prioridade alta), **vinculando ao processo** (pelo nº CNJ) e ao **cliente** (pelo processo cadastrado ou pelo CPF/CNPJ das partes). Reimportar o arquivo do dia **não duplica** os prazos já cadastrados
- 📝 **Notas** — anotações rápidas

Visual em **tema claro**, otimizado para celular e computador.

### ✨ Captura rápida (texto, voz, arquivos e vários destinos)

Na página **Captura rápida** (menu ☰) há uma caixa onde você pode:

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

## 💬 Assistente por IA — a conversa da tela inicial

A caixa de conversa do **Início** é o jeito principal de usar o app (e o botão
**🤖 Perguntar / Fazer** da Captura rápida usa o mesmo assistente). Escreva em
linguagem natural e a IA decide:

- **Pergunta** (consulta seus dados) — ex.: *“qual o prazo do Luciano?”*,
  *“quantos processos de alimentos eu tenho?”*, *“tem tarefa atrasada da Cassiane?”*.
  A IA lê seus **clientes, processos, tarefas, notas e lembretes** e responde.
- **Ordem** (executa, com confirmação) — ex.: *“crie a tarefa contestar até sexta,
  processo 5007764”*, *“marque o prazo do Paulo como feito”*, *“agende audiência dia
  20 às 14h”*, *“cadastre a cliente Maria, CPF…”*, *“anote que o cliente ligou”*.
  A IA mostra **o que vai fazer** e você toca em **Confirmar** (com **Desfazer**
  depois). Ações suportadas: criar tarefa, compromisso de agenda, lembrete, nota,
  **cliente** e **processo**; concluir/reabrir tarefa; lançar andamento no processo;
  corrigir cadastro de processo; excluir um registro.
- **Navegação** (executa na hora, sem confirmação) — ex.: *“abra o processo
  5001234”*, *“me mostre a agenda”*, *“abrir a pasta da Liz”*, *“ligue para o
  Carlos”*, *“mande um WhatsApp para a Ana avisando do prazo”*. Abrir telas e
  registros não altera nada, então acontece imediatamente — comandos simples de
  abrir (*“abrir agenda”*, *“abra o processo 5001234”*) funcionam **até sem IA/nuvem**,
  interpretados no próprio aparelho.

Os dados **não saem do seu navegador para nenhuma IA de terceiros sem passar pelo
seu servidor**: o app envia um retrato dos seus dados para a **sua** função do
Supabase, que fala com o Claude usando a **sua** chave (guardada no servidor).

### Ativar (uma vez)
Igual ao leitor de documentos — se você já fez aquilo, só falta publicar esta função:

1. Chave da **Anthropic** (`https://console.anthropic.com`) e [CLI do Supabase](https://supabase.com/docs/guides/cli) (`supabase login` + `supabase link`).
2. Publique a função e configure a chave:
   ```bash
   supabase functions deploy assistente
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-sua-chave
   # opcional (respostas melhores em perguntas): supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
   ```
3. Pronto. Se a função não estiver instalada, o botão avisa e nada quebra.

> Custa **centavos por pergunta/ordem**. A função está em [`supabase/functions/assistente/index.ts`](supabase/functions/assistente/index.ts).

---

## ☀️ Resumo do dia (briefing automático de todo dia)

Todo dia o app monta, em português, um **resumo direto** cruzando a sua **Agenda
Google** e o seu **Gmail** — para você começar o dia sabendo o que importa. Fica
no menu ☰ → **Resumo do dia** e também aparece como **cartão no topo do Início**.

O resumo tem esta estrutura:

- **📅 Agenda de hoje** — compromissos, audiências e prazos com **horário e local**.
- **📅 Agenda de amanhã** — o mesmo, para você se antecipar.
- **📨 E-mails que precisam de atenção** — as mensagens **não lidas das últimas
  24h** que se destacam, com o **motivo** de cada uma: **cliente** (bate com um
  cliente cadastrado por e‑mail ou nome), **tribunal/cartório** (remetente/assunto
  jurídico, EPROC, PJe…) ou **possível prazo processual** (fala em prazo,
  intimação, audiência, número CNJ…).
- **📬 Outros e-mails** — só a **contagem** dos não lidos que não caíram em nenhum
  destaque (sem detalhar).

Cada e‑mail em destaque leva direto para a mensagem no Gmail; os itens da agenda
abrem a **Agenda**. Há botão **📋 Copiar resumo** (texto pronto para colar).

### 🔔 Aviso às 8h (opcional)

Na página do Resumo, ligue **🔔 Avisar todo dia** e escolha o **horário** (padrão
**08:00**). A partir dessa hora, ao abrir o app você recebe **uma notificação por
dia** com o resumo (tocar na notificação abre direto a página).

> Um app instalado pela web (**PWA**) **não roda 100% sozinho em segundo plano** —
> por isso o aviso dispara **quando o app é aberto a partir do horário marcado**, e
> o resumo do dia já vem **pronto** no cartão do Início. Tudo é montado **no próprio
> navegador**, reaproveitando as conexões de **Agenda** e **Gmail** que você já usa
> (nada é enviado para servidores de IA).

Precisa das mesmas permissões do Google já usadas no app: **Google Agenda**
(compromissos) e **Gmail** leitura (mesmo escopo das *Publicações oficiais*).

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

As publicações ficam **guardadas no aparelho**: ao reabrir o app elas **continuam
aparecendo** (mesmo antes de reconectar o Gmail). Ao tocar em **↻ Atualizar** (ou
automaticamente, uma vez por sessão, quando o Gmail está conectado), as **novas são
mescladas** com as já existentes — **sem duplicar** (a chave é o id da mensagem).

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

## 📴 Modo offline (funciona sem internet)

O app tem uma **camada local** que deixa você continuar trabalhando mesmo **sem conexão**. A Supabase segue sendo o backend principal; o módulo offline é um complemento que **espelha** os dados no aparelho e **sincroniza sozinho** quando a internet volta.

**O que funciona offline** (com os dados já sincronizados neste aparelho):

- **Consultar e pesquisar** clientes, processos, tarefas, agenda, notas e contatos;
- **Cadastrar, editar e apagar** — tudo grava na hora no aparelho;
- **Assistente local** — a conversa da Home resolve, sem internet, comandos como *“crie uma tarefa para ligar para o João amanhã às 9h”*, *“abra o processo do Carlos”*, *“gere uma procuração para a Maria”* e *“quais tarefas eu tenho hoje?”*, operando **só sobre os dados locais**;
- **Gerar documentos** (procuração/declaração) a partir dos modelos que já vêm no app.

**Como aparece na tela** — na barra do topo há um **selo de estado**:

| Selo | Significado |
|------|-------------|
| 🟢 **Online** | Conectado; tudo sincronizado |
| ⚪ **Offline** | Sem internet — as funções locais seguem disponíveis |
| 🔵 **Sincronizando…** | Subindo/baixando alterações |
| 🟡 **N pendentes** | N alterações feitas offline aguardando subir (toque para forçar) |
| 🔴 **Erro de sincronização** | Algo não subiu; toque para tentar de novo |

Além do selo do topo, cada **item** criado/alterado offline mostra um **pontinho discreto no canto** do cartão (🟡 aguardando subir · 🔴 falhou), que **some** assim que sincroniza.

**Como sincroniza** — cada alteração feita offline entra numa **fila de sincronização** (“pendente de sincronização”). Quando a conexão volta, o app **sobe as suas alterações** e depois **baixa** o que foi mudado em outros aparelhos (sincronização bidirecional). Em caso de conflito, vale a **alteração mais recente**, mantendo um **log local** de mudanças.

**O que ainda precisa de internet** (fica avisado na hora): consulta a tribunais, atualização de movimentações, envio de e-mail/WhatsApp, emissão de boletos e a própria sincronização com a nuvem.

**Busca semântica local** — a busca de **Clientes** e **Processos**, e a conversa da IA quando offline, entendem por **sentido**, não só texto exato: reconhecem **sinônimos** do dia a dia jurídico (inventário↔espólio↔herança, barco↔embarcação↔lancha, alimentos↔pensão, divórcio↔separação…) e toleram **erros de digitação**, cruzando todos os campos (nome, CPF, telefone, cidade, partes, vara, comarca, assunto, observações, andamentos). Assim, digitar *“aquele inventário do cliente que tinha um barco”* encontra o processo certo mesmo sem a frase exata estar cadastrada. Tudo roda no aparelho — **funciona sem internet**.

**Fila de ações offline** — quando você tenta uma ação que depende de internet estando offline (por ex. **WhatsApp** ou **e-mail** de um contato, ou pela conversa da IA), o app **não falha**: pergunta *“Esta ação exige conexão. Deixar programado para quando a internet voltar?”*. Se você programar, ela fica guardada. Um selo **⏳ no topo** mostra quantas ações estão programadas; ao voltar a internet o app avisa e você **executa cada uma com um toque** (as janelas de WhatsApp/e-mail só abrem a partir do seu toque — por isso o app lista em vez de disparar sozinho).

> 🔒 Os dados locais deste aparelho são **apagados ao sair** (logout) — desde que nada esteja pendente de sincronização; se houver pendências, elas ficam guardadas até você entrar de novo e a conexão voltar.

### 🔐 Segurança local (bloqueio + criptografia)

Como o app guarda dados sensíveis no aparelho (CPF, processos…), há uma proteção própria — **opcional** (menu ☰ → **Segurança**):

- **Criptografia de verdade**: com a proteção ligada, cada registro do banco local é cifrado com **AES-GCM**. A chave **não fica salva** — é derivada do seu **PIN** (PBKDF2, 210 mil iterações) e vive só na memória enquanto o app está aberto/destravado. No disco, sem o PIN, os dados ficam ilegíveis.
- **Bloqueio por PIN**: pede o PIN ao abrir o app.
- **Expiração de sessão**: trava sozinho após um tempo sem uso (ajustável: 1–30 min).
- **Registro de acessos**: guarda os desbloqueios e as tentativas falhas.
- **Apagar dados deste aparelho**: remove o que está guardado localmente (o que já subiu para a nuvem continua lá).
- **Reversível**: ativar recifra os dados existentes; desativar volta tudo a texto normal. **Esqueceu o PIN?** dá para remover a proteção e entrar de novo — os dados voltam da nuvem (o que estava só local e não sincronizado se perde, pois é criptografado).

> Observação: a criptografia protege os **dados dos cadastros** (o banco local). A proteção é por aparelho — em cada aparelho você define (ou não) o seu PIN.

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
js/store.js             # dados OFFLINE-FIRST (espelho local + fila de sincronização com a nuvem)
js/local.js             # banco local do aparelho (IndexedDB): espelho, fila de sincronização e log
js/actions.js           # fila de AÇÕES offline (WhatsApp/e-mail programados p/ quando a net voltar)
js/search.js            # busca semântica local (sinônimos + tolerância a typo, offline)
js/security.js          # segurança local: bloqueio por PIN + criptografia (AES-GCM/PBKDF2)
js/auth.js              # login (entra offline pela última sessão salva)
js/ui.js                # utilitários e gráfico
js/capture.js           # captura rápida multi-tipo (Tarefa/Agenda/Nota/Cliente/Processo)
js/nlp.js               # interpretador de linguagem natural (prazo, prioridade, área)
js/extract.js           # extração de dados de cliente/processo por REGRAS (pt-BR)
js/ai.js                # leitura de documentos por IA (opcional, via função do Supabase)
js/files.js             # extrai texto de PDF/imagem (OCR)/txt
js/gcal.js              # integração com o Google Agenda
js/gmail.js             # lê e-mails no Gmail (Publicações oficiais e Resumo do dia)
js/resumo.js            # Resumo do dia (briefing Agenda+Gmail; aviso das 8h)
js/app.js               # telas e navegação
supabase/schema.sql     # banco de dados
supabase/functions/extrair/  # função de IA (chave da API fica no servidor)
manifest.webmanifest    # configuração do PWA
sw.js                   # cache dos arquivos (abre offline; guarda também a lib da nuvem)
```
