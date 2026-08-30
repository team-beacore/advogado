export interface ExtractResult {
  text: string | null;
  method: string | null;
  status: 'EXTRACTED' | 'NONE' | 'FAILED' | 'NOT_CONFIGURED';
  error?: string;
}