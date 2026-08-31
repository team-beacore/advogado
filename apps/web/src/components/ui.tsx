import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ApiClientError } from '../api/client';

export function Button({ className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-brand-800/40 transition-all duration-200 hover:bg-brand-800 hover:shadow-elevated focus-visible:ring-2 focus-visible:ring-brand-500/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition-all duration-200 placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-900 shadow-sm transition-all duration-200 placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full appearance-none rounded-lg border border-gray-200 bg-white bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236d7888' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.6' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")] bg-[length:1.15rem] bg-[right_0.6rem_center] bg-no-repeat py-2.5 pl-3.5 pr-9 text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-card transition-shadow duration-200 hover:shadow-elevated">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold tracking-tight text-gray-900">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Badge({ color = 'gray', children }: { color?: string; children: ReactNode }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600 ring-gray-200',
    green: 'bg-success-50 text-success-700 ring-success-100',
    red: 'bg-danger-50 text-danger-700 ring-danger-100',
    yellow: 'bg-warning-50 text-warning-700 ring-warning-100',
    blue: 'bg-info-50 text-info-700 ring-info-100',
    purple: 'bg-brand-50 text-brand-700 ring-brand-100',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
        colors[color] ?? colors.gray
      }`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 4h8l4 4v12H4V4h4Zm0 0v4h8" />
        </svg>
      </div>
      <div className="font-display text-sm font-semibold text-gray-800">{title}</div>
      {hint && <div className="mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500">{hint}</div>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : 'Ocorreu um erro.';
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 7.5v5m0 3.5h.01" />
      </svg>
      <span className="leading-relaxed">{msg}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-t-2xl bg-white p-6 shadow-elevated ring-1 ring-gray-900/5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusColor(status: string | null | undefined): string {
  const map: Record<string, string> = {
    ACTIVE: 'green',
    SUSPENDED: 'yellow',
    ARCHIVED: 'gray',
    CLOSED: 'gray',
    DRAFT: 'blue',
    TODO: 'gray',
    IN_PROGRESS: 'blue',
    DONE: 'green',
    CANCELLED: 'gray',
    PENDING: 'yellow',
    READ: 'blue',
    PROCESSED: 'green',
    NEW: 'blue',
    CONTACTED: 'yellow',
    QUALIFIED: 'purple',
    PROPOSAL: 'purple',
    WON: 'green',
    LOST: 'red',
    LOW: 'gray',
    MEDIUM: 'blue',
    HIGH: 'yellow',
    CRITICAL: 'red',
    APPROVED: 'green',
    REJECTED: 'red',
    EDITED: 'blue',
  };
  return map[status ?? ''] ?? 'gray';
}

export function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    ACTIVE: 'Ativo',
    SUSPENDED: 'Suspenso',
    ARCHIVED: 'Arquivado',
    CLOSED: 'Encerrado',
    DRAFT: 'Rascunho',
    TODO: 'A fazer',
    IN_PROGRESS: 'Em andamento',
    DONE: 'Concluída',
    CANCELLED: 'Cancelada',
    PENDING: 'Pendente',
    READ: 'Lida',
    PROCESSED: 'Processada',
    NEW: 'Novo',
    CONTACTED: 'Contatado',
    QUALIFIED: 'Qualificado',
    PROPOSAL: 'Proposta',
    WON: 'Ganho',
    LOST: 'Perdido',
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta',
    CRITICAL: 'Crítica',
    APPROVED: 'Aprovado',
    REJECTED: 'Reprovado',
    EDITED: 'Editado',
  };
  return map[status ?? ''] ?? (status ?? '');
}
