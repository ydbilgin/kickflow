import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildUserCardElement, configureUserCardSession, dismissUserCard, mapUserCardResponse, openUserCard } from '../../src/content/chat/user-card';
import { setLang } from '../../src/content/shared/i18n';

beforeEach(() => { document.body.innerHTML = ''; setLang('en'); configureUserCardSession('mrstiventc'); });
afterEach(() => { dismissUserCard(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const model = () => mapUserCardResponse({ id: 4852299, username: 'Batmanroller', slug: 'batmanroller',
  subscribed_for: 1, badges: [{ type: 'subscriber', count: 1, active: false }],
  badges_v2: [{ name: 'level', metadata: { level: 28 }, image_url: 'https://ext.cdn.kick.com/chat/badges/28.png', selected: true }],
}, {}, 'Batmanroller', 'batmanroller');

it('provides a Follow on Kick link to this user without dispatching an account write', () => {
  const card = buildUserCardElement(model());
  const link = card.querySelector<HTMLAnchorElement>('[data-kickflow-card-action="follow"]');
  expect(link?.href).toBe('https://kick.com/batmanroller');
  expect(link?.textContent).toBe('Follow on Kick');
  expect(link?.target).toBe('_blank');
});

it('opens the exact native user identity card from the new Kick controls action', () => {
  document.body.innerHTML = '<div id="chatroom-messages"><button title="other">other</button><button title="Batmanroller">Batmanroller</button></div>';
  const clicked = vi.fn(); document.querySelectorAll('button')[1].addEventListener('click', clicked);
  const other = vi.fn(); document.querySelector('button')!.addEventListener('click', other);
  const card = buildUserCardElement(model()); document.body.append(card);
  const action = card.querySelector<HTMLButtonElement>('[data-kickflow-card-action="native"]');
  expect(action).not.toBeNull(); action!.click();
  expect(clicked).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
});

it('keeps the card controls and the user archive stable while profile data loads', async () => {
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => { await ready; return { ok: true, json: async () => ({ username:'Batmanroller',slug:'batmanroller',subscribed_for:1,following_since:null }) }; }));
  const opening = openUserCard('batmanroller','Batmanroller',20,20,null);
  const controls = document.querySelector('.kickflow-user-card__actions');
  expect(controls).not.toBeNull(); const action = controls!.querySelector('[data-kickflow-card-action="native"]');
  release(); await opening;
  expect(document.querySelector('.kickflow-user-card__actions')).toBe(controls);
  expect(document.querySelector('[data-kickflow-card-action="native"]')).toBe(action);
});

it('preserves actual subscription months and level badges without inventing a subscription tier', () => {
  const data = model(); expect(data.subscribedFor).toBe('1 month');
  expect(data.badges.find(b => b.name === 'level')?.level).toBe(28);
  expect(data.badges.find(b => b.type === 'subscriber')?.count).toBe(1);
  expect(data.userId).toBe(4852299);
  expect(buildUserCardElement(data).textContent).not.toMatch(/tier\s*\d/i);
});

it('keeps unknown relationships unknown and adds no unobserved gift or moderation counters', () => {
  const card = buildUserCardElement(mapUserCardResponse({}, {}, 'Alice', 'alice'));
  expect(card.textContent).toContain('unknown');
  expect(card.textContent).not.toMatch(/0 (gift|month)|ban user|timeout|tier\s*\d/i);
});

it('uses the native username for relationship data when the profile slug has different punctuation', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({id:7,username:'Verssa_99',slug:'verssa-99',subscribed_for:0,following_since:null})})));
  await openUserCard('verssa-99','Cosmetic name',20,20,null,'Verssa_99');
  expect(fetch).toHaveBeenCalledWith('https://kick.com/api/v2/channels/mrstiventc/users/Verssa_99',expect.any(Object));
});

it('opens the native username even when the canonical profile slug differs', () => {
  document.body.innerHTML='<div id="chatroom-messages"><button title="Verssa_99">Verssa_99</button><button title="verssa-99">verssa-99</button></div>';
  const native=vi.fn();const wrong=vi.fn();document.querySelectorAll('button')[0].addEventListener('click',native);document.querySelectorAll('button')[1].addEventListener('click',wrong);
  const data=mapUserCardResponse({username:'Verssa_99',slug:'verssa-99'}, {}, 'Verssa_99','verssa-99');
  const card=buildUserCardElement(data);document.body.append(card);
  card.querySelector<HTMLButtonElement>('[data-kickflow-card-action="native"]')!.click();
  expect(native).toHaveBeenCalledOnce();expect(wrong).not.toHaveBeenCalled();
});

it('hydrates canonical profile destinations without replacing the footer or title', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({id:7,username:'Verssa_99',slug:'verssa-99',subscribed_for:0,following_since:null})})));
  const opening=openUserCard('Verssa_99','Verssa_99',20,20,null,'Verssa_99');
  const footer=document.querySelector('.kickflow-user-card__link');const name=document.querySelector('.kickflow-user-card__name');
  await opening;
  expect(document.querySelector('.kickflow-user-card__link')).toBe(footer);expect(document.querySelector('.kickflow-user-card__name')).toBe(name);
  expect((footer as HTMLAnchorElement).href).toBe('https://kick.com/verssa-99');
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){expect(this.href).toBe('https://kick.com/verssa-99');});
  name!.dispatchEvent(new MouseEvent('auxclick',{bubbles:true,button:1}));expect(click).toHaveBeenCalledOnce();
});

it('makes the canonical native profile available by plain title click and keyboard without starting a drag', () => {
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){expect(this.href).toBe('https://kick.com/batmanroller');});
  const card=buildUserCardElement(model());document.body.append(card);
  const name=card.querySelector<HTMLElement>('.kickflow-user-card__name')!;
  expect(name.getAttribute('role')).toBe('link');expect(name.tabIndex).toBe(0);
  const down=new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});name.dispatchEvent(down);expect(down.defaultPrevented).toBe(false);
  name.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));
  name.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));
  expect(click).toHaveBeenCalledTimes(2);
});
