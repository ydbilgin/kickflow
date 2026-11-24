export const CONTROLS_IDLE_MS: number;
export const STRIP_ATTRIBUTE: string;
export const STEP_SECONDS: number;
export const FALLBACK_BAR_CSS: string;
export const FALLBACK_LAYOUT_STYLE_ID: string;

export function inBottomArea(
  rect: { left: number; right: number; bottom: number; height: number },
  x: number,
  y: number,
  barHeight?: number,
): boolean;

export function createTransportIcon(pathData: string): SVGSVGElement;
export function createStepIcon(direction: 'back' | 'forward'): SVGSVGElement;
export function createCameraIcon(): SVGSVGElement;
export function createToLiveIcon(): SVGSVGElement;
export function createBoltIcon(): SVGSVGElement;
export function createOverflowIcon(): SVGSVGElement;
export function createPipIcon(): SVGSVGElement;
export function createGearIcon(): SVGSVGElement;
export function ensureFallbackChrome(): void;
export const PLATE_END_CLASS: string;
export function syncPlateRunEnds(container: Element | null | undefined): void;
