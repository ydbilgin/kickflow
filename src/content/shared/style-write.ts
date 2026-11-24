/** Inline-style writes for the body-level controls that re-align themselves every second (footer
 * button, navbar entry, channel-avatar control). An unchanged write still queues a mutation record
 * on <body> and wakes every page-wide observer, so they write only a changed value. 2026-11-11.
 *
 * Positions are rounded to 1/100 px: Chromium serialises a fractional length to six significant
 * digits, so a raw `13.333333333333334px` never reads back equal and was rewritten every second
 * (soak: the navbar entry still wrote ~180 records/min after a read-back comparison alone). */
export function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export type WritableStyleKey = 'position' | 'zIndex' | 'left' | 'top' | 'width' | 'height' | 'display';

export function setStyleIfChanged(element: HTMLElement, key: WritableStyleKey, value: string): void {
  if (element.style[key] !== value) element.style[key] = value;
}
