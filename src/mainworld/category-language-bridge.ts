import {
  CATEGORY_LANGUAGE_CHIP_SELECTOR, CATEGORY_LANGUAGE_EVENT, CATEGORY_LANGUAGE_RESULT_ATTRIBUTE,
  parseCategoryLanguageRequest, type CategoryLanguageResult,
} from '../shared/category-language';

interface NextRouter {
  replace(url: string, as?: string, options?: { shallow?: boolean; scroll?: boolean }): Promise<boolean> | unknown;
}

const BRIDGE_SLOT = Symbol.for('kickflow.category-language-bridge.v1');

function nextRouter(view: Window): NextRouter | null {
  try {
    const router = (view as Window & { next?: { router?: unknown } }).next?.router as Partial<NextRouter> | undefined;
    return router && typeof router.replace === 'function' ? router as NextRouter : null;
  } catch {
    return null;
  }
}

/** MAIN world: the content chip asks for a category URL; Kick's own Next router applies it the
 * same way Kick's Dil checkbox does (URL `languages`, shallow, no scroll). Only a
 * `button.kickflow-lang-chip` may ask, and only for a /category/<slug> path. 2026-11-24. */
export function installCategoryLanguageBridge(root: Document = document): () => void {
  const state = root as Document & Partial<Record<symbol, () => void>>;
  state[BRIDGE_SLOT]?.();
  const view = root.defaultView ?? window;
  const listener = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof view.HTMLElement) || !target.matches(CATEGORY_LANGUAGE_CHIP_SELECTOR)) return;
    const url = parseCategoryLanguageRequest((event as CustomEvent<unknown>).detail);
    const write = (result: CategoryLanguageResult): void => target.setAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE, result);
    if (!url) { write('invalid'); return; }
    const router = nextRouter(view);
    if (!router) { write('no-router'); return; }
    try {
      const pending = router.replace(url, undefined, { shallow: true, scroll: false });
      write('ok');
      // Next resolves false for a cancelled navigation and rejects for a failed one: either
      // tells the chip at once instead of after its whole wait (review T-6).
      if (pending && typeof (pending as Promise<boolean>).then === 'function') {
        (pending as Promise<boolean>).then((ok) => { if (ok === false) write('failed'); }, () => write('failed'));
      }
    } catch {
      write('failed');
    }
  };
  root.addEventListener(CATEGORY_LANGUAGE_EVENT, listener);
  const teardown = (): void => {
    root.removeEventListener(CATEGORY_LANGUAGE_EVENT, listener);
    if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
  };
  state[BRIDGE_SLOT] = teardown;
  return teardown;
}
