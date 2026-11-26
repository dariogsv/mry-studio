# MRY Visual Studio

Editor web **100% determinístico, local e offline-first** para modelagem, revisão formal, simulação e exportação vetorial de modelos **SPN (Redes de Petri Estocásticas)** e **RBD (Diagramas de Blocos de Confiabilidade)** na sintaxe `.mry` do **Mercury** (MoDCS / CIn-UFPE).

🌐 **Acesso direto (GitHub Pages):** https://dariogsv.github.io/mry-studio/  
🔒 **Privacidade total:** todo o parsing, layout, simulação e exportação rodam **100% no seu navegador** — nenhum arquivo `.mry` é enviado para servidores externos.

---

## ✨ Recursos Principais

- **Conversão Bidirecional Determinística (`MRY ↔ Visual`):** edite o código `.mry` ou o diagrama interativamente mantendo 100% de fidelidade com a sintaxe oficial do Mercury (`place`, `timedTransition`, `immediateTransition`, `enablingFunction`, `inhibitors`, `IF(...):(...)ELSE(...)`, `serverType`, `block`, `hierarchy`, `series`, `parallel`, `kooN`, `top`).
- **Política "Nada Escondido":** `guards`, arcos inibidores (`○`), multiplicidades numéricas, expressões condicionais `IF(...)`, `SingleServer` vs. `InfiniteServer`, distribuições determinísticas, prioridades e SPOFs de RBD são sempre visíveis no diagrama e auditáveis na aba **Nada Escondido**.
- **Cross-Highlight `Código ↔ Visual`:** editor `.mry` recolhível/expansível com *syntax highlighting*; passar o cursor no código destaca os elementos/parâmetros no diagrama e vice-versa.
- **Roteamento Repulsivo + Lugares-Espelho (`🔗 Espelhos`):** protege fronteiras de nomes/tags para evitar cruzamentos e opcionalmente projeta arcos longos em portais compactos (`↗ Nome`) ao lado da transição **sem alterar o `.mry`**.
- **Token Game Interativo (`▶ Simular` / tecla `S`):** executa disparos passo a passo ou aleatórios avaliando `guards`, inibidores, prioridade de transições imediatas e pesos condicionais `IF(...)`, com detecção de *deadlock*, ajuste manual de tokens e verificação ao vivo de **Invariantes de Conservação**.
- **Avaliador Analítico de RBD:** calcula em tempo real Disponibilidade ($A$), Confiabilidade transiente $R(t)$, downtime anual, curva $R(\tau)$, importância de Birnbaum, SPOFs e grupos $k$-de-$N$ heterogêneos via Programação Dinâmica.
- **Tabela Formal & Exportação IEEE:** tabela de pré/pós-condições copiável em **Markdown** e **LaTeX (`booktabs`)**, modo monocromático **IEEE P&B**, e exportação para `.mry` (UTF-8 sem BOM), `.svg` vetorial e `.png` em alta resolução.
- **Produtividade estilo Figma:** barra de ferramentas flutuante, seleção em caixa (*marquee*), áreas visuais editáveis, Desfazer/Refazer (`Ctrl+Z`/`Ctrl+Y`), memória automática indexada por arquivo no `localStorage`, `Shift` (travar eixo), `Ctrl` (reparentar entre áreas) e `Alt` (clonar nó ou bloco com arcos internos).

---

## 🚀 Uso Local ou Offline

### No navegador (sem instalação)
1. Acesse https://dariogsv.github.io/mry-studio/ (após o primeiro acesso, o *Service Worker* permite uso offline); **ou**
2. Clone o repositório e abra diretamente o arquivo `index.html` em qualquer navegador moderno.

### Via linha de comando (Node.js)
```bash
# Executar suíte completa de testes determinísticos (SPN, RBD, Token Game, Espelhos e CLI)
npm test

# Exportar SVG vetorial diretamente de qualquer arquivo .mry
node export_svg.js modelo.mry saida.svg [--ieee] [--mirrors] [--labels=tag|summary|full]
```

---

## ⌨️ Atalhos de Teclado (SPN)

| Atalho | Ação |
| :--- | :--- |
| `V` / `P` / `E` / `D` / `I` | Selecionar / Lugar / Exp / Det / Imediata |
| `Tab` | Alterna conector rápido (`Arco Normal` ↔ `Inibidor ○`) |
| `S` | Entra / sai do modo **Token Game (`▶ Simular`)** |
| `Del` / `Backspace` | Apaga item(ns) ou arco selecionado |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / Refazer |
| `Shift` + arrastar | Trava movimento no eixo horizontal ou vertical |
| `Ctrl` + arrastar | Move elemento entre Áreas visuais |
| `Alt` + arrastar | Clona elemento (ou bloco multi-selecionado + arcos internos) |
| `Espaço` + arrastar / botão do meio | Pan da câmera |

---

## 📄 Licença

Distribuído sob a licença **MIT**. Veja [LICENSE](LICENSE) para mais detalhes.
