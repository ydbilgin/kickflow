// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const bundle = buildSync({
  absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
  entryPoints: ['src/content/bootstrap.ts'], bundle: true, write: false,
  format: 'iife', target: 'chrome110',
}).outputFiles[0].text;

it('reinjecting the complete content bundle during startup installs one bridge, poller and tooltip controller', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://kick.com/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const window = dom.window;
  const messages = vi.fn();
  const changes = vi.fn();
  Object.assign(window, { chrome: {
    runtime: { id: 'offline-test', getManifest: () => ({ version: '0.2.28' }), onMessage: { addListener: messages } },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, onChanged: { addListener: changes } },
  } });
  const intervals = vi.spyOn(window, 'setInterval');
  try {
    window.eval(bundle);
    window.eval(bundle);
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    expect(messages).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(intervals.mock.calls.filter(([, delay]) => delay === 400)).toHaveLength(1);

    const anchor = window.document.createElement('span');
    anchor.setAttribute('data-kickflow-tooltip', 'Moderator');
    window.document.body.append(anchor);
    anchor.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    const tooltips = window.document.querySelectorAll('.kickflow-hover-tooltip');
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].textContent).toBe('Moderator');
    expect(tooltips[0].classList.contains('kickflow-hover-tooltip--visible')).toBe(true);
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltips[0].classList.contains('kickflow-hover-tooltip--visible')).toBe(false);
  } finally {
    // Let frames already queued run while the window is alive and queue no new ones: jsdom's
    // visual frame timer otherwise fires after close() and throws an uncaught TypeError.
    window.requestAnimationFrame = () => 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    dom.window.close();
  }
});
