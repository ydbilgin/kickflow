export type ModActionKind = 'ban' | 'timeout' | 'delete';

export interface ModAction {
  readonly kind: ModActionKind;
  /** Moderator username, or null when the payload did not name one. */
  readonly moderator: string | null;
  /** The affected chatter's display name. */
  readonly victim: string;
  /** A preserved message id we can jump to, or null. */
  readonly messageId: string | null;
  /** Timeout length in minutes. Only meaningful when kind === 'timeout'. */
  readonly durationMin: number | null;
  /** Epoch ms, from the injected clock. */
  readonly at: number;
}

export interface ModActionNotice {
  readonly id: string;
  readonly kind: ModActionKind;
  readonly moderator: string | null;
  readonly durationMin: number | null;
  /** Distinct victims, oldest first, capped at MOD_ACTION_NOTICE_VICTIM_CAP. */
  readonly victims: readonly string[];
  /** Total actions folded in, INCLUDING victims dropped past the cap. */
  readonly count: number;
  /** Jump target. Non-null only when count === 1. */
  readonly messageId: string | null;
  readonly firstAt: number;
  readonly lastAt: number;
}

// Protects the notice from splitting an ordinary burst into multiple rows.
export const MOD_ACTION_BURST_WINDOW_MS = 5_000;
// Protects the notice from growing forever during a slow, steady moderation drip.
export const MOD_ACTION_BURST_MAX_MS = 30_000;
// Protects the DOM and notice text from unbounded victim-name growth during a purge.
export const MOD_ACTION_NOTICE_VICTIM_CAP = 20;

export interface ModActionFeedOptions {
  now?: () => number;
  burstWindowMs?: number;
  burstMaxMs?: number;
  victimCap?: number;
  onNotice: (notice: ModActionNotice) => void;
  onNoticeUpdated: (notice: ModActionNotice) => void;
}

interface MutableNotice {
  id: string;
  kind: ModActionKind;
  moderator: string | null;
  durationMin: number | null;
  victims: string[];
  count: number;
  messageId: string | null;
  firstAt: number;
  lastAt: number;
}

let nextNoticeSequence = 0;

function sameModerator(left: string | null, right: string | null): boolean {
  return left === right;
}

function asNotice(notice: MutableNotice): ModActionNotice {
  return {
    id: notice.id,
    kind: notice.kind,
    moderator: notice.moderator,
    durationMin: notice.durationMin,
    victims: notice.victims.slice(),
    count: notice.count,
    messageId: notice.messageId,
    firstAt: notice.firstAt,
    lastAt: notice.lastAt,
  };
}

export class ModActionFeed {
  private readonly now: () => number;
  private readonly burstWindowMs: number;
  private readonly burstMaxMs: number;
  private readonly victimCap: number;
  private readonly onNotice: (notice: ModActionNotice) => void;
  private readonly onNoticeUpdated: (notice: ModActionNotice) => void;
  private openNotice: MutableNotice | null = null;
  private disposed = false;

  constructor(options: ModActionFeedOptions) {
    this.now = options.now ?? (() => Date.now());
    this.burstWindowMs = options.burstWindowMs ?? MOD_ACTION_BURST_WINDOW_MS;
    this.burstMaxMs = options.burstMaxMs ?? MOD_ACTION_BURST_MAX_MS;
    this.victimCap = Math.max(0, Math.floor(options.victimCap ?? MOD_ACTION_NOTICE_VICTIM_CAP));
    this.onNotice = options.onNotice;
    this.onNoticeUpdated = options.onNoticeUpdated;
  }

  push(action: ModAction): void {
    if (this.disposed) return;

    // `at` is the event timestamp. The fallback keeps the injected clock meaningful for a
    // defensive caller that supplies an invalid runtime payload despite the static type.
    const at = Number.isFinite(action.at) ? action.at : this.now();
    const open = this.openNotice;
    if (open && this.canJoin(open, action, at)) {
      this.join(open, action, at);
      this.onNoticeUpdated(asNotice(open));
      return;
    }

    const notice: MutableNotice = {
      id: `mod-action-${++nextNoticeSequence}`,
      kind: action.kind,
      moderator: action.moderator,
      durationMin: action.kind === 'timeout' ? action.durationMin : null,
      victims: this.victimCap > 0 ? [action.victim] : [],
      count: 1,
      messageId: action.messageId,
      firstAt: at,
      lastAt: at,
    };
    this.openNotice = notice;
    this.onNotice(asNotice(notice));
  }

  clear(): void {
    this.openNotice = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private canJoin(open: MutableNotice, action: ModAction, at: number): boolean {
    return open.kind === action.kind
      && sameModerator(open.moderator, action.moderator)
      && at - open.lastAt <= this.burstWindowMs
      && at - open.firstAt <= this.burstMaxMs;
  }

  private join(open: MutableNotice, action: ModAction, at: number): void {
    open.count++;
    open.messageId = null;
    open.lastAt = Math.max(open.lastAt, at);
    if (open.victims.length < this.victimCap && !open.victims.includes(action.victim)) {
      open.victims.push(action.victim);
    }
  }
}
