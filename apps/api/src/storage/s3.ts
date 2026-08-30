import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { errors } from '../errors';
import type { Storage, StoredFile } from './storage';

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor(opts: S3StorageOptions) {
    if (!opts.bucket) {
      throw errors.validation('S3_BUCKET é obrigatório quando STORAGE_DRIVER=s3.');
    }
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region ?? 'us-east-1',
      endpoint: opts.endpoint || undefined,
      forcePathStyle: opts.forcePathStyle ?? Boolean(opts.endpoint),
      credentials: opts.accessKeyId && opts.secretAccessKey
        ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
        : undefined,
    });
  }

  async save(data: Buffer, key: string): Promise<StoredFile> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
      }),
    );
    const hash = createHash('sha256').update(data).digest('hex');
    return { key, size: data.length, hash };
  }

  async read(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw errors.notFound('Arquivo não encontrado no armazenamento.');
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 503) throw err;
      throw errors.notFound('Arquivo não encontrado no armazenamento.');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // arquivo ausente no storage não impede a exclusão lógica
    }
  }
}