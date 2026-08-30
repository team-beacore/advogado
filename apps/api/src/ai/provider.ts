export interface AIRequest {
  system: string;
  user: string;
  operation: string;
}

export interface AIResponse {
  text: string;
  model: string;
  structured?: Record<string, unknown> | null;
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(req: AIRequest): Promise<AIResponse>;
}
