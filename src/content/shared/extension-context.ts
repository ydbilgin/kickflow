/** False once this content script's extension context is dead (extension reloaded/updated/
 * disabled while the tab stayed open). Then chrome.runtime.id is undefined and any
 * chrome.storage/runtime call throws "Extension context invalidated". A page refresh
 * re-injects a fresh script; a zombie can't recover. */
export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

/** Installed extension version from the manifest, falling back to 'dev' outside a real
 * extension context (offline render harnesses, unit tests). Never hardcode a version literal
 * elsewhere — this is the single source of truth. */
export function getExtensionVersion(): string {
  try {
    return chrome?.runtime?.getManifest?.().version ?? 'dev';
  } catch {
    return 'dev';
  }
}

/** chrome.storage.local.get that resolves to {} instead of throwing/rejecting on a dead
 * context or unavailable storage. */
export async function safeStorageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  if (!isExtensionContextValid()) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch {
    return {};
  }
}

/** chrome.storage.local.set that no-ops instead of throwing/rejecting on a dead context. */
export async function safeStorageSet(items: Record<string, unknown>): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    await chrome.storage.local.set(items);
  } catch {
    /* context invalidated / storage unavailable — nothing to persist to */
  }
}
