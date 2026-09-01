interface LoginVisualPanelProps {
  title?: string;
  subtitle?: string;
}

/**
 * Painel de apresentação compartilhado (Login e Registro).
 * Área visual estática e limpa: fundo azul-marinho, logo,
 * texto institucional e selo "Ambiente seguro".
 */
export default function LoginVisualPanel({
  title = 'Todo o seu escritório, organizado com precisão.',
  subtitle = 'Processos, prazos, intimações e documentos em um ambiente único, seguro e auditável.',
}: LoginVisualPanelProps) {
  return (
    <aside className="relative hidden flex-col justify-between bg-brand-950 p-12 text-white lg:flex">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-brand-700 to-brand-900 ring-1 ring-inset ring-gold-300/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="#d8c188" strokeWidth="1.5" strokeLinecap="round" className="h-[18px] w-[18px]">
            <path d="M12 4v16M6 20h12M4 9h8L8 15 4 9Zm12 0h4l-2 4-2-4Z" />
          </svg>
        </div>
        <span className="font-display text-sm font-semibold tracking-tight">Plataforma Jurídica</span>
      </div>
      <div className="max-w-md">
        <p className="font-display text-[2rem] font-semibold leading-snug tracking-tightest text-white">
          {title}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-white/50">
          {subtitle}
        </p>
      </div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-gold-300/60">Ambiente seguro</div>
    </aside>
  );
}
