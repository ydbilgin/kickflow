import { PlayerMenu } from './player-menu';
import { subscribeLang, t } from '../shared/i18n';
import type { Lifecycle } from '../shared/lifecycle';
import { createOverflowIcon } from './bar-chrome.js';

/**
 * The `⋯` button that appears in Kick's bar only when KickFlow's controls do not all fit
 * (bar-budget.ts). Its menu hosts the REAL control elements — the same nodes the bar would
 * hold — so a collapsed control keeps its listeners, its label and its state, and no control
 * ever gets a second implementation.
 */
export interface OverflowControl {
  readonly element: HTMLElement;
  close(): void;
  /** Takes the button out of the bar and closes the menu; the rows are the caller's to own. */
  detach(): void;
}

export function createOverflowControl(lifecycle: Lifecycle, rows: () => readonly HTMLElement[]): OverflowControl {
  const group = document.createElement('span');
  group.className = 'kickflow-player-group kickflow-player-group--overflow';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kickflow-player-btn kickflow-player-btn--overflow';
  button.setAttribute('aria-haspopup', 'menu');
  button.append(createOverflowIcon());
  group.append(button);

  const menu = new PlayerMenu({
    className: 'kickflow-overflow-menu',
    fill: (root) => {
      for (const control of rows()) {
        const row = document.createElement('div');
        row.className = 'kickflow-overflow-menu__row';
        row.append(control);
        // FINAL 6.3 moment 3: the folded menu names every control and its key. The name is the
        // control's own title ("Ekran görüntüsü al (S)"), split into a label and a key cap.
        const title = control.querySelector('button')?.title ?? '';
        const match = /^(.*?)\s*\(([^()]+)\)$/.exec(title);
        const name = document.createElement('span');
        name.className = 'kickflow-overflow-menu__name';
        name.textContent = match ? match[1] : title;
        row.append(name);
        if (match) {
          const key = document.createElement('kbd');
          key.className = 'kickflow-player-kbd';
          key.textContent = match[2];
          row.append(key);
        }
        root.append(row);
      }
    },
  });

  const applyLang = (): void => {
    button.title = t('player.more_controls');
    button.setAttribute('aria-label', t('player.more_controls'));
  };
  applyLang();

  button.addEventListener('click', () => menu.toggle(button));
  lifecycle.add(subscribeLang(() => {
    applyLang();
    menu.close();
  }));
  lifecycle.add(() => menu.close());

  return {
    element: group,
    close: () => menu.close(),
    detach: () => {
      menu.close();
      group.remove();
    },
  };
}
