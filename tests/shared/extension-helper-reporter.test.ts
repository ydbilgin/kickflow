import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ES module without type declarations
import { createReporter, originOnly } from '../../src/extension-helper-reporter.mjs';

const HELPER = 'idoajpmlahhhlamballfmbkggmfmmidh';
const DIAGNOSTICS = { 'quality-lock-gave-up': 'quality-lock: gave up' };

function fakeRuntime(reply: unknown = { ok: true }, lastError?: { message: string }) {
  const sent: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const runtime = {
    lastError: undefined as unknown,
    sendMessage(id: string, payload: Record<string, unknown>, callback: (r: unknown) => void) {
      sent.push({ id, payload });
      runtime.lastError = lastError;
      callback(reply);
      runtime.lastError = undefined;
    },
  };
  return { runtime, sent };
}

function fakeConsole() {
  return { warn: vi.fn(), error: vi.fn() };
}

function fakeEnvironment() {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
}

describe('extension helper reporter', () => {
  it('sends only a known code, the level and the page origin, never the message text', async () => {
    const { runtime, sent } = fakeRuntime();
    const log = fakeConsole();
    const reporter = createReporter({
      helperId: HELPER, diagnostics: DIAGNOSTICS, runtime, console: log, environment: fakeEnvironment(),
      origin: () => 'https://kick.com/somechannel?token=secret#x',
    });
    reporter.install();
    log.warn('quality-lock: gave up after 6 attempts — private detail', { user: 'someone' });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(HELPER);
    expect(sent[0].payload).toEqual({
      type: 'ext-helper.report.v1', code: 'quality-lock-gave-up', level: 'warn', origin: 'https://kick.com',
    });
    expect(JSON.stringify(sent[0].payload)).not.toContain('private detail');
    reporter.stop();
  });

  it('keeps the original console output and maps unknown text to unclassified', async () => {
    const { runtime, sent } = fakeRuntime();
    const log = fakeConsole();
    const original = log.error;
    const reporter = createReporter({ helperId: HELPER, diagnostics: DIAGNOSTICS, runtime, console: log, environment: fakeEnvironment() });
    reporter.install();
    log.error('something else broke', new Error('stack text'));
    expect(original).toHaveBeenCalledWith('something else broke', expect.any(Error));
    expect(sent[0].payload.code).toBe('unclassified');
    expect(JSON.stringify(sent[0].payload)).not.toContain('stack text');
    reporter.stop();
    expect(log.error).toBe(original);
  });

  it('resolves false without throwing when the helper extension is not installed', async () => {
    const { runtime } = fakeRuntime(undefined, { message: 'Could not establish connection. Receiving end does not exist.' });
    const reporter = createReporter({ helperId: HELPER, diagnostics: DIAGNOSTICS, runtime, console: fakeConsole(), environment: fakeEnvironment() });
    await expect(reporter.report('quality-lock-gave-up')).resolves.toBe(false);
  });

  it('sends at most 60 reports per ten minutes', async () => {
    const { runtime, sent } = fakeRuntime();
    let now = 0;
    const reporter = createReporter({
      helperId: HELPER, diagnostics: DIAGNOSTICS, runtime, console: fakeConsole(), environment: fakeEnvironment(), now: () => now,
    });
    for (let i = 0; i < 70; i++) await reporter.report('quality-lock-gave-up');
    expect(sent).toHaveLength(60);
    now = 600_000;
    await reporter.report('quality-lock-gave-up');
    expect(sent).toHaveLength(61);
  });

  it('is loaded before the content script and in the popup, with no new permission', () => {
    const root = path.resolve(__dirname, '../..');
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const isolated = manifest.content_scripts.find((entry: { js: string[] }) => entry.js.includes('dist/content.js'));
    expect(isolated.js).toEqual(['dist/extension-helper.js', 'dist/content.js']);
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    expect(manifest.externally_connectable).toBeUndefined();
    const popup = readFileSync(path.join(root, 'popup.html'), 'utf8');
    expect(popup.indexOf('dist/extension-helper.js')).toBeGreaterThan(-1);
    expect(popup.indexOf('dist/extension-helper.js')).toBeLessThan(popup.indexOf('dist/popup.js'));
  });

  it('rejects an invalid helper id and strips everything but an http(s) origin', () => {
    expect(() => createReporter({ helperId: 'not-an-id', diagnostics: {} })).toThrow();
    expect(originOnly('https://user:pw@kick.com/a/b?c=d')).toBe('https://kick.com');
    expect(originOnly('chrome-extension://abc/popup.html')).toBe('');
    expect(originOnly('not a url')).toBe('');
  });
});
