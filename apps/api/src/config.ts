import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(__dirname, '..', '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://advogado:advogado@127.0.0.1:54329/advogado'),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me-in-production'),
  COOKIE_NAME: z.string().default('advogado_session'),
  STORAGE_DIR: z.string().default('./data/storage'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  AI_PROVIDER: z.enum(['openai', 'local']).default('openai'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OCR_ENABLED: z.string().default('false'),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(overrides: Record<string, string> = {}): Env {
  const raw: Record<string, string | undefined> = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function getEnv(): Env {
  if (!cached) return loadEnv();
  return cached;
}
