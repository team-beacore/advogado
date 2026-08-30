import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { errors } from '../errors';
import type { Storage, StoredFile } from './storage';

export class LocalStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private fullPath(key: string): string {
    const resolved = resolve(this.root, key);
    if (!resolved.startsWith(this.root)) {
      throw errors.validation('Caminho de armazenamento inválido.');
    }
    return resolved;
  }

  async save(data: Buffer, key: string): Promise<StoredFile> {
    const path = this.fullPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    const hash = createHash('sha256').update(data).digest('hex');
    return { key, size: data.length, hash };
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.fullPath(key));
    } catch {
      throw errors.notFound('Arquivo não encontrado no armazenamento.');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(this.fullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.fullPath(key));
    } catch {
      // arquivo ausente no storage não impede a exclusão lógica
    }
  }
}
