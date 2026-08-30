import { getEnv } from '../config';
import type { Storage } from './storage';
import { LocalStorage } from './local';
import { S3Storage } from './s3';

let cached: Storage | null = null;

export function createStorageFromEnv(): Storage {
  const env = getEnv();
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  return new LocalStorage(env.STORAGE_DIR);
}

export function getStorage(): Storage {
  if (!cached) cached = createStorageFromEnv();
  return cached;
}

export function resetStorageForTests(): void {
  cached = null;
}