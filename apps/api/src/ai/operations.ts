import type { AIProvider } from './provider';
import type { ProcessContext } from './context';

export const AI_DISCLAIMER = 'A IA auxilia o advogado. A revisão e decisão final são humanas. Este conteúdo não substitui análise jurídica profissional.';

export const DISCLAIMER_SYSTEM_PROMPT = `Você é um assistente jurídico que auxilia advogados. 
Você NÃO é uma autoridade jurídica. 
Você organiza, resume e sugere com base no contexto fornecido.
Você sempre deixa claro o que é uma sugestão vs. o que é fato documentado.
Você NUNCA declara prazos jurídicos como fatos definitivos sem deixar claro que precisam de confirmação humana.
Você sempre inclui esta mensagem ou equivalente: "A IA auxilia o advogado. A revisão e decisão final são humanas."`;

export function contextToSystemPrompt(context: ProcessContext): string {
  let docs = 'Nenhum';
  const withContent = context.documents.filter((d) => d.content_extracted);
  if (context.documents.length > 0) {
    docs = `${context.documents.length} anexados (${withContent.length} com conteúdo extraído)`;
  }
  return `${DISCLAIMER_SYSTEM_PROMPT}
  
Contexto atual do processo:
- Título: ${context.process?.title ?? 'N/A'}
- Número: ${context.process?.process_number ?? 'N/A'}
- Tribunal: ${context.process?.court ?? 'N/A'}
- Área: ${context.process?.area ?? 'N/A'}
- Status: ${context.process?.status ?? 'N/A'}
- Cliente: ${context.client?.name ?? 'N/A'}
- Responsável: ${context.responsible?.name ?? 'N/A'}
- Eventos recentes: ${context.recentEvents.length} registrados
- Documentos: ${docs}
- Intimações: ${context.publications.length} registradas
- Tarefas: ${context.tasks.length} pendentes

Conteúdo textual extraído dos documentos (use como fonte de fato, sempre citando o documento):
${extractDocumentExcerpts(context)}`;
}

const MAX_DOC_EXCERPT = 3000;

function extractDocumentExcerpts(context: ProcessContext): string {
  const parts: string[] = [];
  for (const d of context.documents) {
    const text = (d.extracted_text as string | null) ?? '';
    if (!text.trim()) continue;
    parts.push(`\n[DOCUMENTO: ${d.name ?? d.file_name ?? 'sem nome'} (${d.mime_type ?? 'n/a'})]`);
    parts.push(text.slice(0, MAX_DOC_EXCERPT));
  }
  return parts.length > 0 ? parts.join('\n') : 'Nenhum conteúdo textual foi extraído dos documentos anexados.';
}

export function formatContext(context: ProcessContext): string {
  const parts: string[] = [];

  if (context.process) {
    parts.push('--- DADOS DO PROCESSO ---');
    parts.push(`Título: ${context.process.title}`);
    parts.push(`Número: ${context.process.process_number ?? 'Não informado'}`);
    parts.push(`Tribunal: ${context.process.court ?? 'Não informado'}`);
    parts.push(`Jurisdição: ${context.process.jurisdiction ?? 'Não informada'}`);
    parts.push(`Área: ${context.process.area ?? 'Não informada'}`);
    parts.push(`Status: ${context.process.status}`);
    parts.push(`Descrição: ${context.process.description ?? 'Nenhuma'}`);
  }

  if (context.client) {
    parts.push('--- CLIENTE ---');
    parts.push(`Nome: ${context.client.name}`);
    if (context.client.email) parts.push(`Email: ${context.client.email}`);
    if (context.client.phone) parts.push(`Telefone: ${context.client.phone}`);
    if (context.client.cpf_cnpj) parts.push(`CPF/CNPJ: ${context.client.cpf_cnpj}`);
  }

  if (context.recentEvents.length > 0) {
    parts.push('--- EVENTOS RECENTES ---');
    for (const e of context.recentEvents) {
      parts.push(`[${(e as Record<string, unknown>).type ?? ''}] ${(e as Record<string, unknown>).title ?? ''} (${(e as Record<string, unknown>).created_at ?? ''})`);
    }
  }

  if (context.documents.length > 0) {
    parts.push('--- DOCUMENTOS ANEXADOS ---');
    for (const d of context.documents) {
      parts.push(`- ${d.name ?? ''} (${d.mime_type ?? ''}, ${d.size ?? 0} bytes) - ${d.content_extracted ? 'texto extraído disponível' : 'conteúdo textual não extraído'}`);
    }
  }

  if (context.publications.length > 0) {
    parts.push('--- INTIMAÇÕES ---');
    for (const p of context.publications) {
      const rec = p as Record<string, unknown>;
      parts.push(`- Origem: ${rec.source ?? 'N/A'} | Status: ${rec.status} | Prazo: ${rec.possible_due_date ?? 'N/A'}`);
    }
  }

  if (context.tasks.length > 0) {
    parts.push('--- TAREFAS ---');
    for (const t of context.tasks) {
      const rec = t as Record<string, unknown>;
      parts.push(`- ${rec.title} [${rec.priority}] (${rec.status}) Vencimento: ${rec.due_date ?? 'N/A'}`);
    }
  }

  return parts.join('\n');
}

type OperationResult = Record<string, unknown>;

export async function summarizeProcess(provider: AIProvider, context: ProcessContext): Promise<OperationResult> {
  const system = `${contextToSystemPrompt(context)}\n\nCom base no contexto acima, produza um resumo estruturado do processo. Responda SEMPRE em português.`;
  const user = `Elabore um resumo estruturado do processo com os seguintes itens:
1. RESUMO GERAL (2-3 frases)
2. FATOS IMPORTANTES
3. EVENTOS RECENTES RELEVANTES
4. PONTOS DE ATENÇÃO
5. INFORMAÇÕES AUSENTES (se houver)

Formato: resposta em JSON com chaves: "resumo", "fatosImportantes" (array), "eventosRecentes" (array), "pontosAtencao" (array), "informacoesAusentes" (array).`;
  return { operation: 'RESUME', ...await callAi(provider, system, user, 'RESUME') };
}

export async function analyzeIntimation(provider: AIProvider, context: ProcessContext, publicationId: string, publicationContent: string): Promise<OperationResult> {
  const system = contextToSystemPrompt(context);
  const user = `Analise a seguinte intimação/publicação judicial e produza uma análise estruturada:

CONTEÚDO DA INTIMAÇÃO:
${publicationContent.slice(0, 8000)}

Forneça:
1. RESUMO DA INTIMAÇÃO
2. POSSÍVEIS PROVIDÊNCIAS A SEREM TOMADAS (com justificativa)
3. INFORMAÇÕES RELEVANTES PARA O PROCESSO
4. PRAZO IDENTIFICADO (se houver) - ATENÇÃO: não declare como definitivo, indique que precisa de verificação humana
5. JUSTIFICATIVA/ORIGEM

IMPORTANTE: Prazos jurídicos NÃO devem ser declarados como fatos definitivos sem verificação humana.

Formato: resposta em JSON com chaves: "resumo", "providencias" (array de {acao, justificativa}), "informacoesRelevantes" (array), "prazoIdentificado" (string ou null), "verificacaoNecessaria" (string).`;
  return { operation: 'ANALYZE_INTIMATION', publicationId, ...await callAi(provider, system, user, 'ANALYZE_INTIMATION') };
}

export async function suggestDraft(provider: AIProvider, context: ProcessContext, instruction: string): Promise<OperationResult> {
  const system = `${contextToSystemPrompt(context)}\n\nCom base no contexto, prepare uma sugestão de texto jurídico. Esta é uma sugestão inicial que precisa de revisão humana obrigatória antes de qualquer uso.`;
  const user = `Com base no contexto do processo e nos documentos disponíveis, prepare um rascunho sobre o seguinte:

${instruction}

IMPORTANTE:
- Este é um RASCUNHO — revisão humana necessária.
- Não inclua dados que não estejam no contexto.
- Indique explicitamente quando estiver inferindo ou preenchendo lacunas.
- Estruture em seções claras.

Formato: resposta em JSON com chaves: "rascunho" (string, o texto sugerido), "observacoes" (string, observações sobre limitações/lacunas), "documentosReferenciados" (array).`;
  return { operation: 'DRAFT', instruction, ...await callAi(provider, system, user, 'DRAFT') };
}

async function callAi(provider: AIProvider, system: string, user: string, operation: string): Promise<OperationResult> {
  const response = await provider.generate({ system, user, operation });
  const structured = parseStructured(response.text);
  return {
    rawText: response.text,
    structured,
    model: response.model,
    generatedAt: new Date().toISOString(),
    disclaimer: AI_DISCLAIMER,
  };
}

/**
 * Tenta extrair um objeto JSON estruturado da resposta do provedor.
 * Provedores baseados em LLM podem envolver o JSON em blocos de código
 * markdown (```json ... ```) ou adicionar texto ao redor — trata esses
 * casos antes de descartar a resposta como texto puro.
 */
function parseStructured(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const json = JSON.parse(candidate);
      if (typeof json === 'object' && json !== null) {
        return json as Record<string, unknown>;
      }
    } catch {
      // tentar próxima forma
    }
  }
  return null;
}