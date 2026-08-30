import { getEnv } from '../config';
import { errors } from '../errors';
import type { AIProvider, AIRequest, AIResponse } from './provider';

/**
 * Provider compatível com a API da OpenAI (chat completions).
 * Funciona com OpenAI e com qualquer endpoint compatível
 * (configurável via OPENAI_BASE_URL), inclusive modelos locais.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible';

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.OPENAI_API_KEY);
  }

  async generate(req: AIRequest): Promise<AIResponse> {
    const env = getEnv();
    if (!this.isConfigured()) {
      throw errors.aiNotConfigured();
    }
    const endpoint = `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          temperature: 0.2,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw errors.externalUnavailable('Provedor de IA indisponível. Verifique a conectividade e a configuração.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw errors.externalUnavailable(`Provedor de IA retornou erro (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw errors.externalUnavailable('Provedor de IA retornou resposta vazia.');
    }
    return { text, model: json.model ?? env.OPENAI_MODEL };
  }
}
