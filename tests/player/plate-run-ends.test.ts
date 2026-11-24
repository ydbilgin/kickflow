import { describe, expect, it } from 'vitest';
import { PLATE_END_CLASS, syncPlateRunEnds } from '../../src/content/player/bar-chrome.js';

// syncPlateRunEnds replaces `:not(:has(+ .kickflow-player-group:is(:not(#kickflow-catchup-controls),
// .kickflow-player-group--chip)))` (2026-11-09). These cases pin that it marks the same groups.
function bar(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}
const ends = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(`.${PLATE_END_CLASS}`)).map((node) => node.id || node.className);

describe('plate run ends', () => {
  const plate = '<button id="play"></button>'
    + '<span id="kickflow-rewind-controls" class="kickflow-player-group"></span>'
    + '<span id="kickflow-speed-controls" class="kickflow-player-group"></span>'
    + '<span id="kickflow-screenshot-controls" class="kickflow-player-group"></span>'
    + '<span id="kickflow-catchup-controls" class="kickflow-player-group"></span>'
    + '<div id="spacer"></div>';

  it('ends the plate before the chip while the stream is live', () => {
    const el = bar(plate);
    syncPlateRunEnds(el);
    expect(ends(el)).toEqual(['kickflow-screenshot-controls']);
  });

  it('moves the end onto the chip while it shows, and back when it leaves', () => {
    const el = bar(plate);
    const chip = el.querySelector('#kickflow-catchup-controls')!;
    chip.classList.add('kickflow-player-group--chip');
    syncPlateRunEnds(el);
    expect(ends(el)).toEqual(['kickflow-catchup-controls']);
    chip.classList.remove('kickflow-player-group--chip');
    syncPlateRunEnds(el);
    expect(ends(el)).toEqual(['kickflow-screenshot-controls']);
  });

  it('ends every run when a foreign element splits the groups', () => {
    const el = bar(plate);
    el.querySelector('#kickflow-speed-controls')!.after(document.createElement('button'));
    syncPlateRunEnds(el);
    expect(ends(el)).toEqual(['kickflow-speed-controls', 'kickflow-screenshot-controls']);
  });

  it('counts the next element sibling even when hidden, as the selector did', () => {
    const el = bar(plate.replace('<div id="spacer"></div>',
      '<span id="kickflow-overflow-controls" class="kickflow-player-group kickflow-player-group--overflow" hidden></span>'));
    el.querySelector('#kickflow-catchup-controls')!.classList.add('kickflow-player-group--chip');
    syncPlateRunEnds(el);
    expect(ends(el)).toEqual(['kickflow-overflow-controls']);
  });

  it('accepts a missing container', () => {
    expect(() => syncPlateRunEnds(null)).not.toThrow();
  });
});
