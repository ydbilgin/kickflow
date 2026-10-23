import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { ScrollFollowController, attachScrollFollowHover, trimMessageWindow } from '../../src/content/chat/dom-window';
import { RenderQueue } from '../../src/content/chat/render-queue';
import { ChatDomRegistry } from '../../src/content/chat/message-store';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { chatMessage } from '../helpers/chat-message';

const lifecycle = new Lifecycle();
const mount = new ChatOverlayMount(lifecycle);
const follow = new ScrollFollowController(mount.ownList);
const hover = attachScrollFollowHover(mount.ownList, follow);
const registry = new ChatDomRegistry();
const queue = new RenderQueue({
  getContainer: () => mount.getRenderContainer(), registry,
  onFlush(rows) {
    mount.noteContentAppended(rows);
    const decision = hover.decide(rows.length);
    trimMessageWindow(mount.ownList, registry, decision.trimCap);
    follow.observeRows(rows);
    hover.apply(decision);
  },
});
let sequence = 0;
function append(content = 'A chat message for layout verification') {
  const message = chatMessage(`layout-${++sequence}`, { content });
  message.sender.username = 'laureth';
  queue.enqueue(message);
  queue.flushPending();
}
mount.setProbing();
mount.setPrimaryReady();
for (let i = 0; i < 60; i++) append(`Message ${i}: enough history to overflow the panel.`);
append('12:29 laureth: stabiliz diyelim');
Object.assign(window, { chatHarness: { mount, follow, append, dispose() {
  queue.dispose(); hover.dispose(); follow.dispose(); lifecycle.dispose();
} } });
