# ✦ ArchPrompter

Aplicativo web (página única, 100% no navegador) que **gera metaprompts ultrarrealistas** para renderizar imagens de projetos arquitetônicos em IAs de imagem.

Abra `archrender/index.html` no navegador. Nada é enviado para fora do aparelho (a leitura de voz e as fontes usam a rede quando disponível).

> É um app **independente** do "Meu Assistente" — não há vínculo entre os dois.

## Como funciona

Visual em **tons claros com estética de luxo**, feito para arquitetos. Abas principais:

1. **Referências** — anexe fotos da maquete, croquis, plantas, fachadas ou referências de estilo. O metaprompt **instrui a IA a replicar fielmente** a geometria, os materiais e a composição dessas imagens.
2. **Perguntas** — bateria completa **só de clicar**: tipologia, ponto de vista, estilo, materiais (com textura), atmosfera, paleta, luz/clima, lente/abertura/perspectiva, entorno, paisagismo, elementos, acabamento técnico, **motor-alvo** e proporção. Cada bloco tem campo livre.
3. **Descrever** — escreva livremente em português **ou grave um áudio** (transcrição por voz em pt-BR) e o app **pré-seleciona as perguntas**, inclusive o motor-alvo.
4. **Metaprompt** — a saída pronta.
5. **Tour Virtual** — costure vários renders do mesmo projeto num **passeio navegável**: cada imagem é um ambiente e o cliente "caminha" clicando em **hotspots** sobre as portas, com crossfade suave. Dois modos (Visualização e Montagem), coordenadas de hotspot em **porcentagem**, e persistência **100% local** — a configuração fica no `localStorage` e os renders no **IndexedDB**. Vem com um tour de exemplo pronto para testar. Sem 360°/3D e sem backend.

## Motores-alvo

- **Nano Banana (Gemini 2.5 Flash Image)** — metaprompt narrativo longo e detalhado (formato que o Gemini entende melhor).
- **Midjourney v6**, **Stable Diffusion / Flux**, **DALL·E 3 / ChatGPT**, **Unreal Engine 5**, **V-Ray / Corona**, **Octane / Redshift**.

## Saída

- **Metaprompt** em inglês, ultra-detalhado, com materiais **texturizados fisicamente** (roughness, IOR, desgaste) e **ultrarrealismo sempre embutido**.
- **Negative prompt**, **Como usar / parâmetros** e **Racional técnico** em português (com alertas de incoerência física).
