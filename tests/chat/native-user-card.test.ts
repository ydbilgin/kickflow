import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isRequestedNativeUserCardSurface, openNativeUserCard, resetNativeUserCardRequest } from '../../src/content/chat/native-user-card';
beforeEach(() => { document.body.innerHTML = '<div id="chatroom-messages"><button title="alice">alice</button></div>'; resetNativeUserCardRequest(); });
afterEach(() => { resetNativeUserCardRequest(); document.body.innerHTML = ''; vi.restoreAllMocks(); });
function popup(slug='alice') {
  const card=document.createElement('div'); card.id='user-identity'; card.innerHTML=`<a href="https://kick.com/${slug}">${slug}</a><button>Native control</button>`;
  document.body.append(card); return card;
}
it('requires an explicit exact username click before a native card can coexist over own chat', () => {
  const card=popup(); expect(isRequestedNativeUserCardSurface(card)).toBe(false);
  expect(openNativeUserCard('ALICE')).toBe(true);
  expect(isRequestedNativeUserCardSurface(card.querySelector('button')!)).toBe(true);
});
it('does not open a different, disabled or absent native username', () => {
  const button=document.querySelector('button')!; const click=vi.spyOn(button,'click');
  expect(openNativeUserCard('bob')).toBe(false); expect(openNativeUserCard('../alice')).toBe(false);
  button.disabled=true; expect(openNativeUserCard('alice')).toBe(false); expect(click).not.toHaveBeenCalled();
});
it('keeps different identities, unrelated dialogs and later roots outside the exemption', () => {
  openNativeUserCard('alice'); const card=popup('bob'); expect(isRequestedNativeUserCardSurface(card)).toBe(false);
  card.querySelector('a')!.href='https://kick.com/alice'; expect(isRequestedNativeUserCardSurface(card)).toBe(true);
  const unrelated=document.createElement('div'); unrelated.setAttribute('role','dialog'); document.body.append(unrelated);
  expect(isRequestedNativeUserCardSurface(unrelated)).toBe(false);
  card.remove(); const later=popup(); expect(isRequestedNativeUserCardSurface(later)).toBe(false);
});
it('does not carry native popup authority across routes or channel-session reset', () => {
  openNativeUserCard('alice'); const card=popup(); expect(isRequestedNativeUserCardSurface(card)).toBe(true);
  history.pushState({},'', '/another-channel'); expect(isRequestedNativeUserCardSurface(card)).toBe(false);
  history.back(); resetNativeUserCardRequest(); expect(isRequestedNativeUserCardSurface(card)).toBe(false);
});
it('registers the intent before synchronous native popup and paint checks', () => {
  let accepted=false;
  document.querySelector('button')!.addEventListener('click',()=> { const card=popup(); accepted=isRequestedNativeUserCardSurface(card); });
  expect(openNativeUserCard('alice')).toBe(true); expect(accepted).toBe(true);
});

it('revokes a retained native root after it is closed and reinserted', async () => {
  openNativeUserCard('alice'); const card=popup(); expect(isRequestedNativeUserCardSurface(card)).toBe(true);
  card.remove(); await Promise.resolve(); document.body.append(card);
  expect(isRequestedNativeUserCardSurface(card)).toBe(false);
});

it('revokes authorization permanently after detecting a different route', () => {
  openNativeUserCard('alice'); const card=popup();expect(isRequestedNativeUserCardSurface(card)).toBe(true);
  const original=location.href;history.pushState({},'', '/route-away');expect(isRequestedNativeUserCardSurface(card)).toBe(false);
  history.replaceState({},'',original);expect(isRequestedNativeUserCardSurface(card)).toBe(false);
});

it('does not revive a bound card after its profile changes away and back', () => {
  openNativeUserCard('alice');const card=popup();expect(isRequestedNativeUserCardSurface(card)).toBe(true);
  card.querySelector('a')!.href='https://kick.com/bob';expect(isRequestedNativeUserCardSurface(card)).toBe(false);
  card.querySelector('a')!.href='https://kick.com/alice';expect(isRequestedNativeUserCardSurface(card)).toBe(false);
});

it('binds a native username to its distinct canonical profile destination', () => {
  document.querySelector('button')!.title='Verssa_99';document.querySelector('button')!.textContent='Verssa_99';
  expect(openNativeUserCard('Verssa_99','verssa-99')).toBe(true);const card=popup('verssa-99');
  expect(isRequestedNativeUserCardSurface(card)).toBe(true);
});
