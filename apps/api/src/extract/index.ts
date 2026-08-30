import type { ExtractResult } from './types';
import { extractPdf, extractDocx, extractPlainText, extractImage } from './extractors';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/tiff'];

export async function extractText(mimeType: string, buffer: Buffer): Promise<ExtractResult> {
  switch (mimeType) {
    case 'application/pdf':
      return extractPdf(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return extractDocx(buffer);
    case 'text/plain':
    case 'text/csv':
      return extractPlainText(buffer);
    default:
      if (IMAGE_MIMES.includes(mimeType)) {
        return extractImage(buffer);
      }
      return { text: null, method: null, status: 'NONE' };
  }
}