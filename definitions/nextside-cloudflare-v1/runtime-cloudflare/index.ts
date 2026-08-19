import type { DatabasePort, NewNote, Note, Runtime } from '../runtime';
import { getAuthSession, handleAuthRequest, type CloudflareAuthEnv } from './auth';
import { createStoragePort, type StorageServiceBinding } from '../runtime/storage';

export type CloudflareRuntimeEnv = {
  DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  ENVIRONMENT?: string;
  INTERNAL_SERVICE_TOKEN?: string;
  STORAGE_SERVICE?: StorageServiceBinding;
};

type NoteRow = {
  id: string;
  title: string;
  createdAt: string;
};

const missingDatabase = (): never => {
  throw new Error('D1 binding DB is not rendered for this environment');
};

const database = (env: CloudflareRuntimeEnv): D1Database => env.DB ?? missingDatabase();

const createDatabasePort = (env: CloudflareRuntimeEnv): DatabasePort => ({
  async listNotes(userId: string): Promise<Note[]> {
    const result = await database(env)
      .prepare(
        'SELECT id, title, created_at AS createdAt FROM notes WHERE user_id = ? ORDER BY created_at DESC',
      )
      .bind(userId)
      .all<NoteRow>();
    return result.results;
  },

  async createNote(userId: string, input: NewNote): Promise<Note> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const result = await database(env)
      .prepare(
        `INSERT INTO notes (id, user_id, title, created_at)
         VALUES (?, ?, ?, ?)
         RETURNING id, title, created_at AS createdAt`,
      )
      .bind(id, userId, input.title, createdAt)
      .first<Note>();
    return result ?? { id, title: input.title, createdAt };
  },
});

const unsupported = (capability: string): never => {
  throw new Error(`${capability} is not configured by W2.2`);
};

export const createCloudflareRuntime = (env: CloudflareRuntimeEnv): Runtime => ({
  auth: {
    async getSession(request) {
      return getAuthSession(request, env as CloudflareAuthEnv);
    },
    async handle(request) {
      return handleAuthRequest(request, env as CloudflareAuthEnv);
    },
  },
  db: createDatabasePort(env),
  storage: createStoragePort(env.STORAGE_SERVICE),
  files: {
    async put(): Promise<void> {
      unsupported('files');
    },
  },
  jobs: {
    async enqueue(): Promise<void> {
      unsupported('jobs');
    },
  },
  telemetry: {
    event(name, attributes): void {
      console.info('[runtime.telemetry]', JSON.stringify({ name, attributes }));
    },
  },
  email: {
    async send(): Promise<void> {
      unsupported('email');
    },
  },
});
