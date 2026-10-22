// Extension-only diagnostics composition root. Approved integration: 2026-10-22.
import { createReporter } from './extension-helper-reporter.mjs';

export const HELPER_ID = 'idoajpmlahhhlamballfmbkggmfmmidh';
export const DIAGNOSTICS = Object.freeze({
  'quality-lock-gave-up': 'quality-lock: gave up',
  'quality-lock-unconfirmed': 'quality-lock: highest quality could not be confirmed',
  'self-check-failed': 'Extension self-check failed',
});
const SLOT = '__laurethExtensionReporterV1';
// Node fixtures and MAIN-world page scripts have no extension transport.
if (globalThis.chrome?.runtime?.sendMessage && typeof globalThis.addEventListener === 'function'
    && !globalThis[SLOT]) {
  const reporter = createReporter({ helperId: HELPER_ID, diagnostics: DIAGNOSTICS });
  globalThis[SLOT] = reporter;
  reporter.install();
  // This page-spoofable, code-only bridge can only count diagnostics.
  globalThis.addEventListener('laureth:extension-diagnostic-v1', (event) => {
    const detail = event.detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)
        || Object.keys(detail).length !== 1 || !Object.hasOwn(detail, 'code')
        || !Object.hasOwn(DIAGNOSTICS, detail.code)) return;
    void reporter.report(detail.code);
  });
}

