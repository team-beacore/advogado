import type { ReactNode } from 'react';

type SectionKind = 'text' | 'list' | 'objectList' | 'highlight';

const SECTIONS: Record<string, { label: string; kind: SectionKind }> = {
  resumo: { label: 'Resumo', kind: 'text' },
  fatosImportantes: { label: 'Fatos importantes', kind: 'list' },
  eventosRecentes: { label: 'Eventos recentes', kind: 'list' },
  pontosAtencao: { label: 'Pontos de atenção', kind: 'list' },
  informacoesAusentes: { label: 'Informações ausentes', kind: 'list' },
  providencias: { label: 'Providências', kind: 'objectList' },
  informacoesRelevantes: { label: 'Informações relevantes', kind: 'list' },
  prazoIdentificado: { label: 'Prazo identificado', kind: 'highlight' },
  verificacaoNecessaria: { label: 'Verificação necessária', kind: 'text' },
  rascunho: { label: 'Rascunho', kind: 'text' },
  observacoes: { label: 'Observações', kind: 'text' },
  documentosReferenciados: { label: 'Documentos referenciados', kind: 'list' },
};

function renderSection(key: string, value: unknown): ReactNode {
  const section = SECTIONS[key];
  const label = section?.label ?? key;

  if (section?.kind === 'highlight') {
    return (
      <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm leading-relaxed text-warning-700">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-warning-600">{label}</span>
        {value ? String(value) : 'Nenhum prazo identificado'}
      </div>
    );
  }

  if (section?.kind === 'objectList' && Array.isArray(value)) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{label}</div>
        <ul className="mt-1 space-y-2">
          {value.map((item, idx) => {
            if (typeof item !== 'object' || item === null) {
              return <li key={idx} className="text-sm text-gray-700">{String(item)}</li>;
            }
            const obj = item as Record<string, unknown>;
            const acao = obj.acao ?? obj.action ?? '';
            const justificativa = obj.justificativa ?? obj.justification ?? '';
            return (
              <li key={idx} className="rounded-lg border border-gray-200 bg-gray-50/70 px-3.5 py-2.5 leading-relaxed">
                <div className="text-sm font-medium text-gray-800">{String(acao)}</div>
                {justificativa && <div className="mt-0.5 text-sm text-gray-600">{String(justificativa)}</div>}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (section?.kind === 'list' && Array.isArray(value)) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{label}</div>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {value.map((item, idx) => (
            <li key={idx} className="text-sm text-gray-700">{String(item)}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (typeof value === 'string' && value.trim()) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{label}</div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{value}</p>
      </div>
    );
  }

  return null;
}

export function FormattedAIOutput({
  output,
  rawText,
}: {
  output: Record<string, unknown> | null | undefined;
  rawText?: string | null;
}) {
  if (output && Object.keys(output).length > 0) {
    const entries = Object.entries(output);
    return (
      <div className="space-y-4">
        {entries.map(([key, value]) => {
          const node = renderSection(key, value);
          return node ? <div key={key}>{node}</div> : null;
        })}
      </div>
    );
  }

  if (rawText) {
    return <div className="whitespace-pre-wrap text-sm text-gray-700">{rawText}</div>;
  }

  return null;
}
