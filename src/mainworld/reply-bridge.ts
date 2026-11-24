import { parseChatSessionContext, type ChatSessionContext } from '../content/chat/session-context';
import {
  NATIVE_CHAT_EDITOR, NATIVE_CHAT_FOOTER, REPLY_REQUEST_EVENT, liveChatFooter, REPLY_RESULT_ATTRIBUTE, parseReplyRequest,
  type NativeReplyMessage, type ReplyRequest, type ReplyResult, nativeChatReplyBlock,
} from '../shared/reply-contract';

interface ReplyState {
  currentChatroomId: number;
  currentReplyingMessage: NativeReplyMessage | null;
  setReplyingMessage(message: NativeReplyMessage | null): void;
  editorInstance: { current: { focus(): void; getRootElement?(): HTMLElement | null } | null };
}
interface ReplyStore { getState(): ReplyState }
interface Room { chatroomId: number; channelSlug: string }
interface Fiber {
  return?: Fiber;
  memoizedProps?: { value?: unknown };
  dependencies?: { firstContext?: Context };
  memoizedState?: Hook;
}
interface Hook { memoizedState?: unknown; queue?: { getSnapshot?: unknown }; next?: Hook }
interface Context { memoizedValue?: unknown; next?: Context }
const REPLY_BRIDGE_SLOT = Symbol.for('kickflow.reply-bridge.v1');
export interface NativeReplyAdapter { store: ReplyStore; room: Room; editor: HTMLElement }

function replyStore(value: unknown): ReplyStore | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
  const candidate = value as Partial<ReplyStore>;
  if (typeof candidate.getState !== 'function') return null;
  try {
    const state = candidate.getState();
    return state && Number.isSafeInteger(state.currentChatroomId) && state.currentChatroomId >= 0
      && 'currentReplyingMessage' in state && typeof state.setReplyingMessage === 'function'
      && typeof state.editorInstance?.current?.focus === 'function' ? candidate as ReplyStore : null;
  } catch { return null; }
}

/** Kick uses useSyncExternalStoreWithSelector for its module-owned chat store. Its memo hook
 * retains [client/server snapshot getters] and [getState, getInitialState, selector, equality].
 * Accept only a getter pair linked by identity to a real subscription queue on this fiber.
 * This avoids guessing hook indices, invoking arbitrary callbacks, or importing bundle ids.
 * Captured read-only on channel + popout, 2026-10-23; guarded by the live reply contract probe.
 */
function subscribedReplyStore(fiber: Fiber): ReplyStore | null {
  const hooks: Hook[] = [];
  for (let hook = fiber.memoizedState, count = 0; hook && count < 128; hook = hook.next, count++) hooks.push(hook);
  const snapshots = new Set(hooks.map(hook => hook.queue?.getSnapshot).filter(value => typeof value === 'function'));
  for (const hook of hooks) {
    const memo = hook.memoizedState;
    if (!Array.isArray(memo) || memo.length !== 2) continue;
    const [getters, dependencies] = memo as unknown[];
    if (!Array.isArray(getters) || getters.length !== 2 || !snapshots.has(getters[0])
      || !Array.isArray(dependencies) || dependencies.length !== 4
      || typeof dependencies[0] !== 'function' || typeof dependencies[1] !== 'function'
      || typeof dependencies[2] !== 'function') continue;
    const store = replyStore({ getState: dependencies[0] });
    if (store) return store;
  }
  return null;
}

/** Read-only, MAIN-world contract discovery. Re-run per click; never retain a stale room/store.
 * Observed on channel + popout 2026-10-23. Uses named state capabilities, not bundle ids,
 * localized labels, reply-arrow SVGs, or a native target row that virtualization can remove.
 */
export function findNativeReplyAdapter(root: Document = document): NativeReplyAdapter | null {
  const editors = [...root.querySelectorAll<HTMLElement>(NATIVE_CHAT_EDITOR)];
  // Kick mounts a second chat-input inside the native reply-thread dialog. Both can
  // share the same store; counting every editor makes replies fail after opening it.
  // The main composer lives in chatroom-footer on channel and popout (2026-11-06).
  // Since 2026-11 an in-page channel change leaves the previous channel's footer mounted
  // but hidden (liveChatFooter); counting it made every reply fail after the first channel
  // change. Keep the single-editor contract for older shells, but never guess among peers.
  const live = liveChatFooter(root);
  const liveEditors = live ? editors.filter(editor => live.contains(editor)) : [];
  const footerEditors = editors.filter(editor => editor.closest(NATIVE_CHAT_FOOTER));
  const candidates = liveEditors.length > 0 ? liveEditors : footerEditors.length > 0 ? footerEditors : editors;
  if (candidates.length !== 1) return null;
  const editor = candidates[0];
  const key = Object.getOwnPropertyNames(editor).find(name => name.startsWith('__reactFiber$'));
  let fiber = key ? (editor as unknown as Record<string, Fiber>)[key] : undefined;
  let store: ReplyStore | null = null;
  let room: Room | null = null;
  const inspect = (value: unknown): void => {
    if (!room && value && typeof value === 'object') {
      const candidate = value as Partial<Room>;
      if (Number.isSafeInteger(candidate.chatroomId) && candidate.chatroomId! > 0
        && typeof candidate.channelSlug === 'string') room = candidate as Room;
    }
  };
  for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
    store ??= subscribedReplyStore(fiber);
    inspect(fiber.memoizedProps?.value);
    let context = fiber.dependencies?.firstContext;
    for (let count = 0; context && count < 64; count++, context = context.next) inspect(context.memoizedValue);
    if (store && room) return { store, room, editor };
  }
  return null;
}

export function nativeReplyRoomMatches(adapter: NativeReplyAdapter, context: ChatSessionContext): boolean {
  const nativeRoom = adapter.store.getState().currentChatroomId;
  // Observed 2026-10-23: native popout keeps the queue-room sentinel at 0 even after loading.
  // The editor's own room context and route still bind this store. A contradictory positive
  // room is always rejected; the zero sentinel is accepted only on the popout route.
  return context.kind === 'live' && adapter.room.channelSlug.toLowerCase() === context.slug.toLowerCase()
    && (nativeRoom === adapter.room.chatroomId || (context.sessionKey.startsWith('popout:') && nativeRoom === 0));
}

export function selectNativeReply(request: ReplyRequest, root: Document = document): ReplyResult {
  const route = parseChatSessionContext(root.location.pathname);
  if (route?.kind !== 'live' || route.sessionKey !== request.sessionKey) return 'wrong-room';
  try {
    const blocked = nativeChatReplyBlock(root);
    if (blocked) return blocked;
    const adapter = findNativeReplyAdapter(root);
    if (!adapter) return 'unavailable';
    if (adapter.room.chatroomId !== request.message.chatroom_id || !nativeReplyRoomMatches(adapter, route)) return 'wrong-room';
    adapter.store.getState().setReplyingMessage(request.message);
    const selected = adapter.store.getState().currentReplyingMessage;
    if (selected?.id !== request.message.id || selected.chatroom_id !== request.message.chatroom_id) return 'unavailable';
    // Native reply state supplies the quote, cancel and send metadata. Never touch editor text,
    // prepend @mentions, call send functions, or synthesize Enter/click on a send control.
    const nativeEditor = adapter.store.getState().editorInstance.current;
    // Thread and main composer share the store; mounting the thread can rebind this
    // ref to its Lexical editor. Only use the ref when it owns our selected DOM root.
    if (nativeEditor?.getRootElement?.() === adapter.editor) nativeEditor.focus();
    else adapter.editor.focus();
    return 'selected';
  } catch { return 'unavailable'; }
}

export function installReplyBridge(root: Document = document): () => void {
  const state = root as Document & Partial<Record<symbol, () => void>>;
  state[REPLY_BRIDGE_SLOT]?.();
  const listener = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('button.kickflow-message__reply-action')) return;
    const request = parseReplyRequest((event as CustomEvent<unknown>).detail);
    const result = request ? selectNativeReply(request, root) : 'invalid-target';
    target.setAttribute(REPLY_RESULT_ATTRIBUTE, result);
  };
  root.addEventListener(REPLY_REQUEST_EVENT, listener);
  const teardown = (): void => {
    root.removeEventListener(REPLY_REQUEST_EVENT, listener);
    if (state[REPLY_BRIDGE_SLOT] === teardown) delete state[REPLY_BRIDGE_SLOT];
  };
  state[REPLY_BRIDGE_SLOT] = teardown;
  return teardown;
}
