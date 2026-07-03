# ✦ ArchPrompter

Aplicativo web (página única, 100% no navegador) que **gera metaprompts ultrarrealistas** para renderizar imagens de projetos arquitetônicos em IAs de imagem.

Abra `archrender/index.html` no navegador. Nada é enviado para fora do aparelho (a leitura de voz e as fontes usam a rede quando disponível).

> É um app **independente** do "Meu Assistente" — não há vínculo entre os dois.

## Como funciona

Visual em **tons claros com estética de luxo**, feito para arquitetos. Quatro abas:

1. **Referências** — anexe fotos da maquete, croquis, plantas, fachadas ou referências de estilo. O metaprompt **instrui a IA a replicar fielmente** a geometria, os materiais e a composição dessas imagens.
2. **Perguntas** — bateria completa **só de clicar**: tipologia, ponto de vista, estilo, materiais (com textura), atmosfera, paleta, luz/clima, lente/abertura/perspectiva, entorno, paisagismo, elementos, acabamento técnico, **motor-alvo** e proporção. Cada bloco tem campo livre.
3. **Descrever** — escreva livremente em português **ou grave um áudio** (transcrição por voz em pt-BR) e o app **pré-seleciona as perguntas**, inclusive o motor-alvo.
4. **Metaprompt** — a saída pronta.

> **Exterior ou interior?** Ao anexar o projeto, escolha se é de **área externa** ou de **interior** — o app ajusta as perguntas: no interior some o que não se aplica (céu, entorno, paisagismo) e aparecem **Ambiente / cômodo** e **Iluminação do ambiente**. O metaprompt também passa a descrever layout, superfícies e mobiliário em vez de volumetria/fachada. A cena é detectada automaticamente pela leitura da imagem e pela descrição em texto.

## Motores-alvo

- **Nano Banana (Gemini 2.5 Flash Image)** — metaprompt narrativo longo e detalhado (formato que o Gemini entende melhor).
- **Midjourney v6**, **Stable Diffusion / Flux**, **DALL·E 3 / ChatGPT**, **Unreal Engine 5**, **V-Ray / Corona**, **Octane / Redshift**.

## Saída

- **Metaprompt** em inglês, ultra-detalhado, com materiais **texturizados fisicamente** (roughness, IOR, desgaste) e **ultrarrealismo sempre embutido**.
- **Negative prompt**, **Como usar / parâmetros** e **Racional técnico** em português (com alertas de incoerência física).
