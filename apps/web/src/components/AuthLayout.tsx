import type { ReactNode } from 'react';
import LoginVisualPanel from './LoginVisualPanel';

interface AuthLayoutProps {
  children: ReactNode;
  panelTitle?: ReactNode;
  panelSubtitle?: string;
}

/**
 * Layout dividido de autenticação.
 * Esquerda: área institucional em azul-marinho (marca + mensagem + benefícios).
 * Direita: área clara, limpa e focada na conversão.
 */
export default function AuthLayout({ children, panelTitle, panelSubtitle }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.02fr_1fr]">
      <LoginVisualPanel title={panelTitle} subtitle={panelSubtitle} />

      <main className="relative flex items-center justify-center overflow-hidden bg-[#F8FAFC] px-5 py-14 sm:px-8">
        {/* Formas geométricas extremamente sutis ao fundo */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-50/80 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-brand-50/50 blur-3xl" />

        <div className="absolute right-8 top-7 hidden text-right lg:block">
          <p className="text-[11px] font-semibold uppercase leading-relaxed tracking-[0.16em] text-gray-400">
            Soluções jurídicas
            <br />
            para um futuro mais eficiente.
          </p>
          <div className="ml-auto mt-2 h-0.5 w-10 rounded-full bg-brand-400" />
        </div>

        <div className="w-full max-w-[26rem] animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
