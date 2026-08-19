import type { StoragePort } from './storage';

export type Note = {
  id: string;
  title: string;
  createdAt: string;
};

export type NewNote = {
  title: string;
};

export type AuthSession = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    emailVerified: boolean;
  };
  session: {
    id: string;
    token: string;
    expiresAt: string | Date;
  };
};

export interface AuthPort {
  getSession(request: Request): Promise<AuthSession | null>;
  handle(request: Request): Promise<Response>;
}

export interface DatabasePort {
  listNotes(userId: string): Promise<Note[]>;
  createNote(userId: string, input: NewNote): Promise<Note>;
}

export interface FilesPort {
  put(key: string, value: ArrayBuffer, contentType: string): Promise<void>;
}

export type StorageRuntimePort = StoragePort;

export interface JobsPort {
  enqueue(name: string, payload: unknown): Promise<void>;
}

export interface TelemetryPort {
  event(name: string, attributes?: Record<string, string>): void;
}

export interface EmailPort {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface Runtime {
  auth: AuthPort;
  db: DatabasePort;
  storage: StorageRuntimePort;
  files: FilesPort;
  jobs: JobsPort;
  telemetry: TelemetryPort;
  email: EmailPort;
}
