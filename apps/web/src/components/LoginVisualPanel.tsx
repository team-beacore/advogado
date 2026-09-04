import type { ReactNode } from 'react';

interface LoginVisualPanelProps {
  title?: ReactNode;
  subtitle?: string;
}

const benefits = [
  {
    title: 'Gestão completa de processos',
    text: 'Acompanhe tudo em um só lugar.',
    icon: 'M6 3h7l5 5v13H6V3Zm7 0v5h5M9 13h6M9 17h6',
  },
  {
    title: 'Prazos e intimações em dia',
    text: 'Mais segurança para o seu time.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2',
  },
  {
    title: 'Seus dados protegidos',
    text: 'Conformidade com a LGPD.',
    icon: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z',
  },
  {
    title: 'Mais produtividade',
    text: 'Menos trabalho manual.',
    icon: 'M13 3 4 14h6l-1 7 9-11h-6l1-7Z',
  },
];

/**
 * Painel institucional (área esquerda) de Login e Cadastro.
 * Azul-marinho profundo, marca, mensagem institucional, benefícios e selo de segurança.
 */
export default function LoginVisualPanel({
  title = (
    <>
      Todo o seu escritório,
      <br />
      <span className="text-brand-300">organizado com precisão.</span>
    </>
  ),
  subtitle = 'Processos, prazos, intimações e documentos em um ambiente único, seguro e auditável.',
}: LoginVisualPanelProps) {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 p-10 text-white xl:p-14 lg:flex">
      {/* Camada 2 — bg_login sobre o azul-marinho (transparente: deixa o azul aparecer) */}
      <img
        src="/bg_login.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Camada 3 — overlay/gradiente sutil para legibilidade, sem virar banner */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-gold-300/5 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(84,130,169,0.12),transparent_55%)]" />
      </div>

      {/* Marca */}
      <div className="relative flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-brand-700 to-brand-900 ring-1 ring-inset ring-gold-300/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="#d8c188" strokeWidth="1.5" strokeLinecap="round" className="h-[18px] w-[18px]">
            <path d="M12 4v16M6 20h12M4 9h8L8 15 4 9Zm12 0h4l-2 4-2-4Z" />
          </svg>
        </div>
        <div>
          <div className="font-display text-sm font-semibold tracking-tight">Plataforma Jurídica</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold-300/70">Gestão que impulsiona resultados</div>
        </div>
      </div>

      {/* Mensagem institucional */}
      <div className="relative max-w-md">
        <p className="font-display text-[1.9rem] font-semibold leading-[1.18] tracking-tightest text-white">
          {title}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-white/55">{subtitle}</p>

        {/* Benefícios */}
        <ul className="mt-9 space-y-5">
          {benefits.map((b) => (
            <li key={b.title} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-gold-300 ring-1 ring-inset ring-white/10">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
                  <path d={b.icon} />
                </svg>
              </span>
              <div>
                <div className="text-sm font-semibold text-white/90">{b.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-white/45">{b.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Rodapé institucional */}
      <div className="relative">
        <div className="mb-3 h-px w-12 bg-gold-300/40" />
        <div className="text-xs italic text-white/45">Tecnologia a serviço da justiça.</div>
        <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-300/70">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-300" />
          Ambiente seguro
        </div>
      </div>
    </aside>
  );
}
