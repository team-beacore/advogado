import type { ExtractResult } from './types';

export async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? (item.str as string) : ''))
        .join(' ');
      pages.push(text);
      page.cleanup();
    }
    await doc.destroy();
    const text = pages.join('\n').trim();
    if (text.length === 0) {
      return { text: null, method: 'pdf', status: 'NONE' };
    }
    return { text, method: 'pdf', status: 'EXTRACTED' };
  } catch (err) {
    return { text: null, method: 'pdf', status: 'FAILED', error: (err as Error).message };
  }
}

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value ?? '').trim();
    if (text.length === 0) {
      return { text: null, method: 'docx', status: 'NONE' };
    }
    return { text, method: 'docx', status: 'EXTRACTED' };
  } catch (err) {
    return { text: null, method: 'docx', status: 'FAILED', error: (err as Error).message };
  }
}

export async function extractPlainText(buffer: Buffer): Promise<ExtractResult> {
  const text = buffer.toString('utf8').trim();
  if (text.length === 0) return { text: null, method: 'text', status: 'NONE' };
  return { text, method: 'text', status: 'EXTRACTED' };
}

let ocrConfigured = false;
export function setOcrConfigured(val: boolean): void {
  ocrConfigured = val;
}

export async function extractImage(buffer: Buffer): Promise<ExtractResult> {
  if (!ocrConfigured) {
    return { text: null, method: 'ocr', status: 'NOT_CONFIGURED', error: 'OCR não configurado. Ative OCR_ENABLED=true no ambiente.' };
  }
  try {
    const Tesseract = await import('tesseract.js');
    const { data } = await Tesseract.recognize(buffer, 'por', {});
    const text = (data.text ?? '').trim();
    if (text.length === 0) return { text: null, method: 'ocr', status: 'NONE' };
    return { text, method: 'ocr', status: 'EXTRACTED' };
  } catch (err) {
    return { text: null, method: 'ocr', status: 'FAILED', error: (err as Error).message };
  }
}