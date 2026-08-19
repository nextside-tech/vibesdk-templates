import { describe, expect, it } from 'bun:test';
import { createCloudflareRuntime } from '../runtime-cloudflare/index.ts';

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    if (!this.sql.includes('FROM notes WHERE user_id = ?')) {
      throw new Error(`unexpected all SQL: ${this.sql}`);
    }
    const [userId] = this.params;
    const results = [...(this.database.notesByUser.get(userId) ?? [])].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    return { results };
  }

  async first() {
    if (!this.sql.includes('INSERT INTO notes')) {
      throw new Error(`unexpected first SQL: ${this.sql}`);
    }
    const [id, userId, title, createdAt] = this.params;
    const note = { id, title, createdAt };
    const bucket = this.database.notesByUser.get(userId) ?? [];
    bucket.push(note);
    this.database.notesByUser.set(userId, bucket);
    return note;
  }
}

class FakeD1Database {
  constructor() {
    this.notesByUser = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

describe('runtime notes contract', () => {
  it('scopes reads and writes to the authenticated user id', async () => {
    const DB = new FakeD1Database();
    const runtime = createCloudflareRuntime({
      DB,
      BETTER_AUTH_SECRET: 'test-secret',
    });

    const alpha = await runtime.db.createNote('user_alpha', { title: 'alpha note' });
    const beta = await runtime.db.createNote('user_beta', { title: 'beta note' });

    expect(alpha.title).toBe('alpha note');
    expect(beta.title).toBe('beta note');

    const alphaNotes = await runtime.db.listNotes('user_alpha');
    const betaNotes = await runtime.db.listNotes('user_beta');

    expect(alphaNotes).toEqual([alpha]);
    expect(betaNotes).toEqual([beta]);
  });
});
