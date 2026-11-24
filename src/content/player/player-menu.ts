import { findPlayerWrapper } from '../shared/selectors';
import { PlayerMenu as SharedPlayerMenu, type PlayerMenuOptions as SharedPlayerMenuOptions } from './bar-shared.js';

/**
 * The one popup mechanism the player controls share. The mechanism itself lives in
 * bar-shared.js (2026-10-29) so a fallback player bar opens the same menus; this
 * wrapper only names Kick's player wrapper as the host.
 */
export type PlayerMenuOptions = Omit<SharedPlayerMenuOptions, 'host'>;

export class PlayerMenu extends SharedPlayerMenu {
  constructor(options: PlayerMenuOptions) {
    super({ ...options, host: findPlayerWrapper });
  }
}
