export const NORMAL_PLAYBACK_RATE: number;

export const SPEED_RATES: readonly number[];
export const SPEED_GRID_RATES: readonly number[];
export const SPEED_GRID_COLUMNS: number;
export function formatPlaybackRate(rate: number, lang: string): string;
export function displayObservedRate(rate: number, lang: string): string;

export const CATCHUP_PLAYBACK_RATE: number;
export const BEHIND_THRESHOLD_SECONDS: number;
export const CHIP_HIDE_SECONDS: number;
export const CAUGHT_UP_THRESHOLD_SECONDS: number;
export const CATCHUP_MIN_START_BUFFER_SECONDS: number;
export const CATCHUP_MIN_KEEP_BUFFER_SECONDS: number;
export const CATCHUP_STALL_HOLD_MS: number;
export const CATCHUP_MAX_STALL_HOLD_MS: number;
export function stallHoldMs(stalls: number): number;
export function createSeekRecoveryTracker(): (type: string, video: HTMLVideoElement) => boolean;

export type CatchupAction =
  | { kind: 'none' }
  | { kind: 'setRate'; rate: number }
  | { kind: 'manualDropToNormal' };

export function decideCatchup(input: {
  mode: 'auto' | 'manual';
  manualRate: number;
  catchingUp: boolean;
  behindBy: number;
  behindPlausible: boolean;
  /** Seconds of media loaded ahead of the playhead; null = nothing loaded there. Omitted only by
   * callers that do not measure the buffer (no buffer guard is applied then). */
  bufferAhead?: number | null;
  /** True while catch-up is held off after a rebuffer. */
  stallHold?: boolean;
}): CatchupAction;

export function bufferAheadSeconds(video: HTMLVideoElement): number | null;

export interface BudgetControl {
  id: string;
  /** Rendered width plus the flex gap the control occupies in its group. 0 = not measurable. */
  cost: number;
}

export interface BudgetPlan {
  /** Ids that stay in the bar, in bar order. */
  mounted: string[];
  /** Ids that move into the overflow menu, in bar order. */
  collapsed: string[];
  /** Whether the `⋯` button itself belongs in the bar. */
  overflow: boolean;
}

export interface BudgetInput {
  /** Pixels the bar can give the plate without moving anything the player owns. */
  free: number;
  /** Cost of the `⋯` button, measured the same way as any other control. */
  overflowCost: number;
  /** Every registered control, in bar order. */
  controls: readonly BudgetControl[];
  /** Ids in the order they should be given up — first entry collapses first. */
  collapseOrder: readonly string[];
}

export function planBarBudget(input: BudgetInput): BudgetPlan;
export function samePlan(left: BudgetPlan, right: BudgetPlan): boolean;

export interface PlayerMenuOptions {
  /** Menu-specific class, added beside the shared `kickflow-player-menu` shell class. */
  className: string;
  /** Fills a freshly created, still-hidden menu. Runs on every open, so it always shows state. */
  fill: (menu: HTMLElement) => void;
  /** Element to focus when the menu opens. */
  initialFocus?: (menu: HTMLElement) => HTMLElement | null;
  /** The player element that hosts the menu outside fullscreen. */
  host?: () => Element | null;
}

export class PlayerMenu {
  constructor(options: PlayerMenuOptions);
  readonly element: HTMLDivElement | null;
  readonly isOpen: boolean;
  toggle(anchor: HTMLElement): void;
  open(anchor: HTMLElement): void;
  close(): void;
}

export type QualityIntent = 'best' | 'auto' | 'saver';
/** An intent, or an exact rendition label such as '720p60'. */
export type QualityMode = string;
export const QUALITY_INTENTS: readonly QualityIntent[];
export const DEFAULT_QUALITY_MODE: QualityIntent;
export const SAVER_MAX_HEIGHT: number;
export const QUALITY_ATTRIBUTE: string;
export function normalizeQualityMode(value: unknown): QualityMode | null;
export function qualityScore(text: string | null | undefined): number;
export function qualityHeight(text: string | null | undefined): number | null;
export function isAutoQualityLabel(text: string | null | undefined): boolean;
export function qualityModeLabel(text: string | null | undefined): string | null;
export function qualityLabelForLevel(level: { height?: number; frameRate?: number } | null | undefined): string | null;
export function pickQuality(mode: QualityMode, labels: readonly string[]): number | null;
export function qualityRenditions(labels: readonly string[]): string[];

export interface QualityWords {
  title: string;
  chip: string;
  subBest: string;
  subAuto: string;
  subSaver: string;
  /** Short word beside an exact pick; the native bar sets it while the pick is this stream's only. */
  subExact?: string;
  best: string;
  bestHint: (current: string | null) => string;
  auto: string;
  autoHint: string;
  saver: string;
  saverHint: string;
  more: string;
}
export function qualityChipParts(mode: QualityMode, current: string | null, words: QualityWords): { value: string; sub: string };
export function paintQualityChip(button: HTMLElement, mode: QualityMode, current: string | null, words: QualityWords): void;
export function createQualityButton(): HTMLButtonElement;
export function fillQualityMenu(menu: HTMLElement, options: {
  mode: QualityMode;
  current: string | null;
  renditions: readonly string[];
  words: QualityWords;
  onPick: (mode: QualityMode) => void;
}): void;

export const CLIP_SECONDS: number;
export const CLIP_VIDEO_BITS_PER_SECOND: number;

export function createCaptureNamer(): (pathname: string, extension: string, now?: Date) => string;
export function showCaptureStatus(host: Element | null, text: string): void;
export function showFrameToast(host: Element | null, url: string, filename: string, heading: string, ms?: number): number | null;

export type LocalClipTextKey =
  | 'clip_stop' | 'clip_record' | 'clip_preview' | 'clip_save' | 'clip_ready' | 'clip_recording'
  | 'clip_unsupported' | 'capture_no_frame' | 'capture_failed' | 'close';

export interface LocalClipOptions {
  getVideo: () => (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
  getHost: () => Element | null;
  filename: (extension: string) => string;
  text: (key: LocalClipTextKey) => string;
  title?: (recording: boolean) => string;
  /** Value of the button's data-kickflow-local-clip attribute; default 'kickflow'. */
  scope?: string;
}

export interface LocalClip {
  toggle(): boolean;
  cancel(): void;
  closePreview(): void;
  refreshButtons(): void;
  createButton(): HTMLButtonElement;
  isRecording(): boolean;
}

export function createLocalClip(options: LocalClipOptions): LocalClip;
