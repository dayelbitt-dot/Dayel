# ✦ ArchRender Master

Aplicativo web (uma única página, 100% no navegador) que **gera prompts de renderização ultra-realistas para projetos arquitetônicos**, seguindo o metaprompt do *ArchRender Master*.

Abra `archrender/index.html` no navegador — não precisa de servidor nem internet. Nada é enviado para fora do aparelho.

## Como funciona

O app tem 4 abas:

1. **Imagens de referência** — anexe fotos da maquete, croquis, plantas, fachadas ou referências de estilo (arraste ou clique). Marque o que cada imagem representa. Ficam só no navegador.
2. **Perguntas objetivas** — uma bateria completa de perguntas **só de clicar**, cobrindo:
   - Tipologia · ponto de vista · estilo arquitetônico
   - Materiais (concreto, madeira, corten, mármore, vidro…)
   - Atmosfera e paleta de cores
   - Iluminação, horário e clima
   - Lente, abertura, perspectiva e altura de câmera
   - Entorno, paisagismo e elementos de cena
   - Estética de render e **motor-alvo** (Midjourney, Stable Diffusion, DALL·E 3, Unreal Engine 5, V-Ray/Corona, Octane)
   - Proporção da imagem

   Cada bloco tem também um **campo de texto livre** para o que não estiver nas opções.
3. **Descrever em texto** — se preferir, escreva livremente em português como quer a imagem; o app lê as palavras e **pré-seleciona as perguntas** para você só refinar.
4. **Prompt gerado** — a saída padronizada:
   - **PROMPT** em inglês (idioma de maior acurácia dos modelos de difusão), montado pela fórmula
     `Tipologia + Estilo + Materiais + Câmera/Lente + Iluminação/Clima + Entorno/Paisagismo + Render`,
     já formatado para o motor escolhido (ex.: `--ar 16:9 --v 6.0` no Midjourney).
   - **NEGATIVE PROMPT** (crucial para Stable Diffusion; adaptado às escolhas).
   - **PARÂMETROS SUGERIDOS** (steps, CFG, sampler, exposição etc., conforme o motor).
   - **RACIONAL TÉCNICO** em português, justificando lente, luz e materiais — e **alertando sobre incoerências físicas** (ex.: sol de meio-dia com neblina densa, verticais distorcidas em ultra-wide).

Botões de **copiar** por seção e **copiar tudo**.

## Diretrizes seguidas (do metaprompt)

- Prompt sempre em **inglês** com precisão técnica (sem termos amadores como *beautiful*, *masterpiece*).
- Uso de vocabulário de **PBR, iluminação, fotografia e história da arquitetura**.
- **Diagnóstico → estruturação → output padronizado** em 3 seções.
- **Detecção de contradições físicas** antes de entregar o prompt.
