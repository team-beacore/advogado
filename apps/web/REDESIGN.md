# Redesign visual — LegalTech premium

Somente estilização. Nenhuma rota, chamada de API, hook, tipo ou regra de negócio foi alterada.
Nenhum arquivo foi criado, movido ou renomeado (exceto este README, que pode ser descartado).

## Arquivos alterados
- `index.html` — fontes Inter + Plus Jakarta Sans, theme-color.
- `tailwind.config.js` — paleta institucional (grafite/carvão/off-white, azul-marinho `brand`,
  petróleo, dourado `gold` como detalhe), tokens de estado (`success`/`danger`/`warning`/`info`),
  sombras (`card`, `elevated`), raios e animações discretas.
- `src/index.css` — base tipográfica, foco acessível, scrollbar, e classes utilitárias
  (`page-title`, `section-title`, `field-label`, `eyebrow`, `surface`, `table-legal`, `skeleton`, `link-quiet`).
- `src/components/ui.tsx` — Button/SecondaryButton/Input/Textarea/Select/Card/Badge/EmptyState/
  ErrorAlert/Modal reestilizados (mesmas props, mesmas assinaturas, mesmos helpers).
- `src/components/Layout.tsx` — sidebar navy com grupos, ícones em linha e indicador dourado do item ativo;
  header sticky com avatar/iniciais, papel do usuário e ação Sair; drawer no mobile. Rotas inalteradas.
- `src/components/FormattedAIOutput.tsx` — hierarquia visual dos blocos de saída de IA.
- `src/pages/*.tsx` — títulos, toolbars de busca/filtro, cards, tabelas, abas, badges, paginação,
  estados de loading/empty/erro e responsividade.

## Observações
- Nenhum dado fictício foi introduzido; apenas os dados já retornados pela API são exibidos.
- A única mudança de estado local nova é o `mobileOpen` do drawer da sidebar (apresentação).
