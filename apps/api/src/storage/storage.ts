export interface StoredFile {
  key: string;
  size: number;
  hash: string;
}

export interface Storage {
  save(data: Buffer, key: string): Promise<StoredFile>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface StorageConfig {
  driver: 'local' | 's3';
  localDir?: string;
  s3?: {
    bucket: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

export function resolveStorageKey(orgId: string, id: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${orgId}/${id}/${safeName}`;
}
