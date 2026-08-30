import type { AIProvider, AIRequest, AIResponse } from './provider';

/**
 * Provider de IA local/offline (sem rede).
 * Implementa uma geração determinística baseada em regras sobre o contexto
 * fornecido — sem chaves de API, sem dados inventados: extrai apenas o que
 * existe no contexto real do processo. É uma implementação real da interface
 * AIProvider, útil para ambientes sem conectividade.
 */
export class LocalAIProvider implements AIProvider {
  readonly name = 'local-rules';

  isConfigured(): boolean {
    return true;
  }

  async generate(req: AIRequest): Promise<AIResponse> {
    const context = req.system ?? '';
    const operation = req.operation;

    let structured: Record<string, unknown>;
    if (operation === 'ANALYZE_INTIMATION') {
      structured = {
        resumo: summarizeText(req.user),
        providencias: [{ acao: 'Revisar a intimação e verificar prazos junto ao tribunal', justificativa: 'Prazo identificado no conteúdo — confirmação humana obrigatória' }],
        informacoesRelevantes: extractLines(req.user, ['Prazo', 'Tribunal', 'Processo', 'Número']),
        prazoIdentificado: extractDateLike(req.user),
        verificacaoNecessaria: 'Verificar a data de publicação e o prazo efetivo junto ao sistema do tribunal',
      };
    } else if (operation === 'DRAFT') {
      structured = {
        rascunho: `Rascunho gerado localmente para a instrução: "${truncate(req.user, 200)}"\n\n[Texto de apoio baseado no contexto do processo. Revisão humana obrigatória.]`,
        observacoes: 'Gerado por provedor local determinístico (offline). Não é texto jurídico definitivo.',
        documentosReferenciados: extractDocNames(context),
      };
    } else {
      structured = {
        resumo: summarizeText(`${context}\n${req.user}`),
        fatosImportantes: extractLines(context, ['Título', 'Número', 'Tribunal', 'Status']),
        eventosRecentes: [],
        pontosAtencao: context.includes('prazo') || context.toLowerCase().includes('prazo') ? ['Verificar prazos processuais manualmente'] : [],
        informacoesAusentes: ['Confirmação de prazos e análise jurídica humana'],
      };
    }

    return {
      text: JSON.stringify(structured),
      model: 'local-rules',
      structured,
    };
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function summarizeText(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 400 ? `${clean.slice(0, 400)}…` : clean;
}

function extractLines(source: string, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const re = new RegExp(`-\\s*${key}:\\s*([^\\n]+)`, 'i');
    const m = source.match(re);
    if (m?.[1] && !['N/A', 'Não informado', 'Nenhuma'].includes(m[1].trim())) {
      out.push(`${key}: ${m[1].trim()}`);
    }
  }
  return out;
}

function extractDateLike(source: string): string | null {
  const m = source.match(/\d{1,2}\/\d{2}\/\d{4}/);
  return m?.[0] ?? null;
}

function extractDocNames(source: string): string[] {
  const out: string[] = [];
  const re = /\[DOCUMENTO:\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}