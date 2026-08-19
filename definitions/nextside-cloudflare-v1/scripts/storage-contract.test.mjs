import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createStoragePort } from '../runtime/storage.ts';

const SECRET_PATTERN =
  '(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----)';

class RecordingStorageService {
  entries = new Map();

  async fetch(input) {
    const request = input instanceof Request ? input : new Request(input);
    const appId = request.headers.get('x-nextside-app-id');
    const scopedKey = request.headers.get('x-nextside-storage-key');
    if (!appId || !scopedKey) {
      return new Response('missing storage headers', { status: 400 });
    }

    const bucket = this.entries.get(appId) ?? new Map();
    bucket.set(scopedKey, Buffer.from(await request.arrayBuffer()).toString('utf8'));
    this.entries.set(appId, bucket);
    return new Response(null, { status: 204 });
  }
}

describe('storage contract', () => {
  it('isolates objects for two appIds through scoped capabilities', async () => {
    const binding = new RecordingStorageService();
    const storage = createStoragePort(binding);
    const alpha = storage.capabilityFor('alpha-app');
    const beta = storage.capabilityFor('beta-app');

    await storage.put(alpha, {
      key: 'notes/welcome.txt',
      value: new TextEncoder().encode('alpha').buffer,
      contentType: 'text/plain',
    });
    await storage.put(beta, {
      key: 'notes/welcome.txt',
      value: new TextEncoder().encode('beta').buffer,
      contentType: 'text/plain',
    });

    expect(binding.entries.get('alpha-app')?.get('apps/alpha-app/notes/welcome.txt')).toBe('alpha');
    expect(binding.entries.get('beta-app')?.get('apps/beta-app/notes/welcome.txt')).toBe('beta');
    expect(binding.entries.get('alpha-app')?.has('apps/beta-app/notes/welcome.txt')).toBe(false);
    expect(binding.entries.get('beta-app')?.has('apps/alpha-app/notes/welcome.txt')).toBe(false);
  });

  it('flags real secrets while ignoring template placeholders', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'nextside-storage-secret-scan-'));
    try {
      const runtimeSecret = ['sk-', 'ABCDEFGHIJKLMNOPQRSTUVWX'].join('');
      await writeFile(join(fixtureDir, 'placeholders.txt'), '{{STORAGE_SERVICE_NAME}}\n');
      await writeFile(join(fixtureDir, 'secret.txt'), `export OPENAI_API_KEY="${runtimeSecret}"\n`);

      const result = spawnSync('rg', ['-n', SECRET_PATTERN, fixtureDir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('secret.txt');
      expect(result.stdout).not.toContain('placeholders.txt');
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
