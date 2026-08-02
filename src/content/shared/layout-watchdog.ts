import { logger } from './logger';

export const LAYOUT_WATCHDOG_POLL_INTERVAL_MS = 500; // Protects detection latency without a tight polling loop.
export const LAYOUT_WATCHDOG_RING_BUFFER_CAP = 120; // Protects the in-memory history from unbounded growth.
export const LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES = 200 * 1024; // Protects localStorage from oversized trip records.
export const LAYOUT_WATCHDOG_STORAGE_KEY = 'kickflow-layout-watchdog';
export const LAYOUT_WATCHDOG_RECOVERY_COMMAND =
  `copy(localStorage.getItem('${LAYOUT_WATCHDOG_STORAGE_KEY}'))`;

const SIDEBAR_COLLAPSED_WIDTH_PX = 60; // Protects the normal channel layout from a clipped sidebar sliver.
const HORIZONTAL_OVERFLOW_TOLERANCE_PX = 2; // Protects against subpixel rounding noise at the document edge.
const NAVBAR_ZERO_HEIGHT_PX = 0; // Protects the top navigation from disappearing entirely.
const NAVBAR_TOP_EDGE_PX = 0; // Protects the top navigation from being clipped above the viewport.
const WIDTH_BUDGET_TOLERANCE_PX = 30; // Protects the normal three-column layout from losing width.
const CONTROL_BAR_MISSING_CONSECUTIVE_POLLS = 2; // Protects against transient control-bar render gaps.

const SIDEBAR_ROW_SELECTOR =
  '[data-testid^="sidebar-following-channel-"], [data-testid^="sidebar-recommended-channel-"]';
const SIDEBAR_WRAPPER_SELECTOR = '#sidebar-wrapper';

export type LayoutInvariantName =
  | 'sidebar-collapsed'
  | 'horizontal-overflow'
  | 'navbar-offscreen'
  | 'width-budget'
  | 'control-bar-missing';

export const LAYOUT_INVARIANT_NAMES: readonly LayoutInvariantName[] = [
  'sidebar-collapsed',
  'horizontal-overflow',
  'navbar-offscreen',
  'width-budget',
  'control-bar-missing',
];

export type LayoutInvariantResult = 'pass' | 'fail' | 'unverifiable';

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshot {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
  documentElement: {
    clientWidth: number;
    scrollWidth: number;
  } | null;
  fullscreen: boolean;
  theatre: string | null;
  navbar: LayoutRect | null;
  sidebar: LayoutRect | null;
  video: LayoutRect | null;
  wrapper: LayoutRect | null;
  chatMessages: LayoutRect | null;
  overlay: LayoutRect | null;
  controlBar: LayoutRect | null;
  wrapperClasses: string[] | null;
  kickflowControls: Array<{ id: string; rect: LayoutRect }>;
}

export interface LayoutViewport {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
}

export interface LayoutWatchdogRuntime {
  captureSnapshot: () => LayoutSnapshot;
  setInterval: (handler: () => void, intervalMs: number) => number;
  clearInterval: (id: number) => void;
  storage: Storage | null;
  now: () => number;
  getUrl: () => string;
}

export interface LayoutWatchdogOptions {
  document?: Document;
  viewport?: LayoutViewport;
  captureSnapshot?: () => LayoutSnapshot;
  setInterval?: (handler: () => void, intervalMs: number) => number;
  clearInterval?: (id: number) => void;
  storage?: Storage | null;
  now?: () => number;
  getUrl?: () => string;
}

export interface LayoutWatchdogTripRecord {
  invariant: LayoutInvariantName;
  timestamp: string;
  url: string;
  ringBuffer: LayoutSnapshot[];
  tripCount: number;
}

function round(value: number): number {
  return Math.round(value);
}

function measureRect(element: Element | null): LayoutRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function resolveNavbar(documentRef: Document): HTMLElement | null {
  // The dashboard owns a body-level <nav>; skip that child navigation so the first remaining
  // structural <nav> is Kick's page navbar rather than an extension-owned control rail.
  return Array.from(documentRef.querySelectorAll<HTMLElement>('nav'))
    .find((nav) => !nav.closest('.kickflow-panel')) ?? null;
}

/** Kick exposes the sidebar as `#sidebar-wrapper`; this developer-facing structural ID is
 * independent of locale and Tailwind utility classes. The semantic-row fallbacks cover captured
 * DOM variants where Kick keeps the same rows but changes the wrapper element. */
export function findLayoutSidebar(documentRef: Document): HTMLElement | null {
  const wrapper = documentRef.querySelector<HTMLElement>(SIDEBAR_WRAPPER_SELECTOR);
  if (wrapper) return wrapper;

  const rows = Array.from(documentRef.querySelectorAll<HTMLElement>(SIDEBAR_ROW_SELECTOR));
  const section = rows[0]?.closest<HTMLElement>('section') ?? null;
  if (section && rows.every((row) => section.contains(row))) return section;

  // Some captured shells expose the same semantic rows under an aside instead of a section.
  for (const aside of documentRef.querySelectorAll<HTMLElement>('aside')) {
    if (rows.some((row) => aside.contains(row))) return aside;
  }
  return null;
}

function resolveTheatreValue(wrapper: HTMLElement | null): string | null {
  return wrapper?.closest<HTMLElement>('[data-theatre]')?.getAttribute('data-theatre') ?? null;
}

function resolveControlBar(wrapper: HTMLElement | null): HTMLElement | null {
  return wrapper?.querySelector<HTMLElement>('div.z-controls.bottom-0') ?? null;
}

function resolveWrapperClasses(wrapper: HTMLElement | null): string[] | null {
  return wrapper ? Array.from(wrapper.classList).sort() : null;
}

export function captureLayoutSnapshot(
  documentRef: Document,
  viewport: LayoutViewport,
): LayoutSnapshot {
  const video = documentRef.querySelector<HTMLElement>('#video-player');
  const wrapper = video?.parentElement ?? null;
  const sidebar = findLayoutSidebar(documentRef);
  const documentElement = documentRef.documentElement;

  return {
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    innerWidth: viewport.innerWidth,
    innerHeight: viewport.innerHeight,
    documentElement: documentElement
      ? {
          clientWidth: documentElement.clientWidth,
          scrollWidth: documentElement.scrollWidth,
        }
      : null,
    fullscreen: documentRef.fullscreenElement != null,
    theatre: resolveTheatreValue(wrapper),
    navbar: measureRect(resolveNavbar(documentRef)),
    sidebar: measureRect(sidebar),
    video: measureRect(video),
    wrapper: measureRect(wrapper),
    chatMessages: measureRect(documentRef.querySelector('#chatroom-messages')),
    overlay: measureRect(documentRef.querySelector('#kickflow-chat-overlay')),
    controlBar: measureRect(resolveControlBar(wrapper)),
    wrapperClasses: resolveWrapperClasses(wrapper),
    kickflowControls: Array.from(
      documentRef.querySelectorAll<HTMLElement>('[id^="kickflow-"][id$="-controls"]'),
    ).map((element) => ({ id: element.id, rect: measureRect(element)! })),
  };
}

function isTheatreActive(snapshot: LayoutSnapshot): boolean {
  return snapshot.theatre === 'true';
}

function evaluateSidebarCollapsed(snapshot: LayoutSnapshot): LayoutInvariantResult {
  if (isTheatreActive(snapshot)) return 'pass';
  if (!snapshot.sidebar) return 'unverifiable';
  return snapshot.sidebar.width < SIDEBAR_COLLAPSED_WIDTH_PX ? 'fail' : 'pass';
}

function evaluateHorizontalOverflow(snapshot: LayoutSnapshot): LayoutInvariantResult {
  const documentElement = snapshot.documentElement;
  if (!documentElement) return 'unverifiable';
  return documentElement.scrollWidth - documentElement.clientWidth > HORIZONTAL_OVERFLOW_TOLERANCE_PX
    ? 'fail'
    : 'pass';
}

function evaluateNavbarOffscreen(snapshot: LayoutSnapshot): LayoutInvariantResult {
  if (!snapshot.navbar) return 'unverifiable';
  return snapshot.navbar.height <= NAVBAR_ZERO_HEIGHT_PX || snapshot.navbar.y < NAVBAR_TOP_EDGE_PX
    ? 'fail'
    : 'pass';
}

function evaluateWidthBudget(snapshot: LayoutSnapshot): LayoutInvariantResult {
  if (isTheatreActive(snapshot)) return 'pass';
  if (!snapshot.sidebar || !snapshot.video || !snapshot.chatMessages) return 'unverifiable';
  const usedWidth = snapshot.sidebar.width + snapshot.video.width + snapshot.chatMessages.width;
  return Math.abs(usedWidth - snapshot.innerWidth) > WIDTH_BUDGET_TOLERANCE_PX ? 'fail' : 'pass';
}

function evaluateControlBarMissing(snapshot: LayoutSnapshot): LayoutInvariantResult {
  if (!snapshot.wrapper || !snapshot.wrapperClasses) return 'unverifiable';
  if (snapshot.wrapperClasses.includes('cursor-none')) return 'pass';
  return snapshot.controlBar ? 'pass' : 'fail';
}

/** Pure invariant evaluation. The control-bar invariant's two-poll duration is owned by the
 * watchdog state machine; this function only answers what the current snapshot says. */
export function evaluateLayoutInvariant(
  name: LayoutInvariantName,
  snapshot: LayoutSnapshot,
): LayoutInvariantResult {
  switch (name) {
    case 'sidebar-collapsed':
      return evaluateSidebarCollapsed(snapshot);
    case 'horizontal-overflow':
      return evaluateHorizontalOverflow(snapshot);
    case 'navbar-offscreen':
      return evaluateNavbarOffscreen(snapshot);
    case 'width-budget':
      return evaluateWidthBudget(snapshot);
    case 'control-bar-missing':
      return evaluateControlBarMissing(snapshot);
  }
}

export function evaluateLayoutInvariants(
  snapshot: LayoutSnapshot,
): Record<LayoutInvariantName, LayoutInvariantResult> {
  return Object.fromEntries(
    LAYOUT_INVARIANT_NAMES.map((name) => [name, evaluateLayoutInvariant(name, snapshot)]),
  ) as Record<LayoutInvariantName, LayoutInvariantResult>;
}

function resolveStorage(): Storage | null {
  try {
    return localStorage;
  } catch (error) {
    logger.warn('Layout watchdog could not access localStorage; trip records will not persist.', error);
    return null;
  }
}

function createDefaultRuntime(options: LayoutWatchdogOptions): LayoutWatchdogRuntime {
  const documentRef = options.document ?? document;
  const viewport = options.viewport ?? window;
  return {
    captureSnapshot: options.captureSnapshot ?? (() => captureLayoutSnapshot(documentRef, viewport)),
    setInterval: options.setInterval ?? ((handler, intervalMs) => window.setInterval(handler, intervalMs)),
    clearInterval: options.clearInterval ?? ((id) => window.clearInterval(id)),
    storage: options.storage === undefined ? resolveStorage() : options.storage,
    now: options.now ?? (() => Date.now()),
    getUrl: options.getUrl ?? (() => window.location.href),
  };
}

function serializedByteLength(value: string): number {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(value).byteLength : value.length;
}

function isTripCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class LayoutWatchdog {
  private readonly runtime: LayoutWatchdogRuntime;
  private intervalId: number | null = null;
  private running = false;
  private previousSerializedSnapshot = '';
  private readonly ringBuffer: LayoutSnapshot[] = [];
  private readonly invariantStates = new Map<LayoutInvariantName, LayoutInvariantResult>();
  private controlBarMissingPolls = 0;

  constructor(options: LayoutWatchdogOptions = {}) {
    this.runtime = createDefaultRuntime(options);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollNow();
    this.intervalId = this.runtime.setInterval(
      () => this.pollNow(),
      LAYOUT_WATCHDOG_POLL_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      this.runtime.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.previousSerializedSnapshot = '';
    this.ringBuffer.length = 0;
    this.invariantStates.clear();
    this.controlBarMissingPolls = 0;
  }

  /** Runs one owned poll without needing to wait for the scheduler. It is also the seam used by
   * deterministic tests; a stopped watchdog cannot read the DOM or write storage. */
  pollNow(): LayoutSnapshot | null {
    if (!this.running) return null;
    try {
      const snapshot = this.runtime.captureSnapshot();
      this.appendChangedSnapshot(snapshot);
      this.evaluateTransitions(snapshot);
      return snapshot;
    } catch (error) {
      logger.warn('Layout watchdog poll failed; the current layout sample was skipped.', error);
      return null;
    }
  }

  getRingBuffer(): LayoutSnapshot[] {
    return this.ringBuffer.slice();
  }

  private appendChangedSnapshot(snapshot: LayoutSnapshot): void {
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.previousSerializedSnapshot) return;
    this.previousSerializedSnapshot = serialized;
    this.ringBuffer.push(snapshot);
    if (this.ringBuffer.length > LAYOUT_WATCHDOG_RING_BUFFER_CAP) this.ringBuffer.shift();
  }

  private evaluateTransitions(snapshot: LayoutSnapshot): void {
    const evaluations = evaluateLayoutInvariants(snapshot);
    for (const name of LAYOUT_INVARIANT_NAMES) {
      const result = this.resolveEffectiveResult(name, evaluations[name]);
      const previous = this.invariantStates.get(name);
      // An invariant that becomes measurable and is already failing is a real transition into
      // failure, so `unverifiable` trips as well as `pass`. Only the very first observation is
      // exempt: with no prior state there is no history worth persisting yet.
      if ((previous === 'pass' || previous === 'unverifiable') && result === 'fail') {
        this.persistTrip(name);
      }
      this.invariantStates.set(name, result);
    }
  }

  private resolveEffectiveResult(
    name: LayoutInvariantName,
    result: LayoutInvariantResult,
  ): LayoutInvariantResult {
    if (name !== 'control-bar-missing') return result;
    if (result !== 'fail') {
      this.controlBarMissingPolls = 0;
      return result;
    }
    this.controlBarMissingPolls++;
    return this.controlBarMissingPolls >= CONTROL_BAR_MISSING_CONSECUTIVE_POLLS ? 'fail' : 'pass';
  }

  private readPersistedTripCount(): number {
    const storage = this.runtime.storage;
    if (!storage) return 0;
    try {
      const raw = storage.getItem(LAYOUT_WATCHDOG_STORAGE_KEY);
      if (!raw) return 0;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return 0;
      const tripCount = (parsed as Partial<LayoutWatchdogTripRecord>).tripCount;
      return isTripCount(tripCount) ? tripCount : 0;
    } catch (error) {
      logger.warn('Layout watchdog could not read its localStorage trip counter.', error);
      return 0;
    }
  }

  private persistTrip(invariant: LayoutInvariantName): void {
    const storage = this.runtime.storage;
    if (!storage) {
      logger.warn('Layout watchdog could not persist this trip because localStorage is unavailable.');
      this.logTrip(invariant);
      return;
    }

    const record: LayoutWatchdogTripRecord = {
      invariant,
      timestamp: new Date(this.runtime.now()).toISOString(),
      url: this.runtime.getUrl(),
      ringBuffer: this.ringBuffer.slice(),
      tripCount: this.readPersistedTripCount() + 1,
    };
    let serialized = JSON.stringify(record);
    while (
      serializedByteLength(serialized) > LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES
      && record.ringBuffer.length > 0
    ) {
      record.ringBuffer.shift();
      serialized = JSON.stringify(record);
    }

    if (serializedByteLength(serialized) > LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES) {
      logger.warn('Layout watchdog trip record exceeded its storage cap and was not written.');
      this.logTrip(invariant);
      return;
    }

    try {
      storage.setItem(LAYOUT_WATCHDOG_STORAGE_KEY, serialized);
    } catch (error) {
      logger.warn('Layout watchdog could not persist its trip record to localStorage.', error);
    }

    this.logTrip(invariant);
  }

  private logTrip(invariant: LayoutInvariantName): void {
    logger.warn(
      `Layout watchdog detected a "${invariant}" layout failure. `
      + `Run this in the ordinary page console to recover the saved history: ${LAYOUT_WATCHDOG_RECOVERY_COMMAND}`,
    );
  }
}
