import { describe, expect, it } from 'vitest';
import { cloneSanitizedNativeDom } from '../../src/content/chat/native-dom-sanitizer';

describe('native DOM clone presentation sanitiser', () => {
  it('strips Kick layout state while retaining content styling and media dimensions', () => {
    const nativeContent = document.createElement('div');
    nativeContent.dataset.testid = 'pinned-message-content';
    nativeContent.hidden = true;
    nativeContent.setAttribute('inert', '');
    nativeContent.className = [
      '[&>a:hover]:text-primary-base',
      'break-words',
      'text-sm',
      'font-semibold',
      'line-clamp-2',
      'sm:line-clamp-3',
      'truncate',
      'text-ellipsis',
      'max-h-10',
      'max-w-[20rem]',
      'h-0',
      'w-full',
      'size-1',
      'hidden',
      'md:invisible',
      'sr-only',
      'hover:opacity-0',
      'absolute',
      'fixed',
      'overflow-hidden',
      'overflow-x-scroll',
      'leading-none',
      'aspect-video',
      'animate-pulse',
      'transition-all',
      'duration-300',
      'translate-x-full',
      'whitespace-nowrap',
      'lg:[display:none]',
    ].join(' ');
    nativeContent.style.cssText = [
      'display: none',
      'position: absolute',
      'overflow: hidden',
      'max-height: 0',
      'width: 1px',
      'line-height: 0',
      'opacity: 0',
      'transition: all 2s',
      'animation: pulse 2s infinite',
      'aspect-ratio: 1 / 1',
      'color: rgb(117, 253, 70)',
      'font-weight: 600',
    ].join(';');

    const paragraph = document.createElement('p');
    paragraph.className = 'keep-block sticky leading-[1.2]';
    paragraph.textContent = 'Gerçek Kick-benzeri blok içerik';
    const emote = document.createElement('img');
    emote.src = 'https://files.kick.com/emotes/789/fullsize';
    emote.alt = 'BLOCKEMOTE';
    emote.title = 'BLOCKEMOTE';
    emote.className = 'keep-emote h-0 w-full size-0 h-6 w-6 size-7 max-h-4 absolute overflow-hidden';
    emote.style.cssText = 'width:24px;height:24px;opacity:0;position:absolute;object-fit:contain';
    nativeContent.append(paragraph, emote);

    const clone = cloneSanitizedNativeDom(nativeContent);
    const clonedParagraph = clone.querySelector('p');
    const clonedEmote = clone.querySelector('img');

    expect(clone.className).toBe('[&>a:hover]:text-primary-base break-words text-sm font-semibold');
    expect(clone.hidden).toBe(false);
    expect(clone.hasAttribute('inert')).toBe(false);
    expect(clone.style.color).toBe('rgb(117, 253, 70)');
    expect(clone.style.fontWeight).toBe('600');
    expect(clone.style.display).toBe('');
    expect(clone.style.position).toBe('');
    expect(clone.style.overflow).toBe('');
    expect(clone.style.width).toBe('');
    expect(clone.style.lineHeight).toBe('');
    expect(clone.style.opacity).toBe('');
    expect(clonedParagraph?.className).toBe('keep-block');
    expect(clonedEmote?.className).toBe('keep-emote h-6 w-6 size-7');
    expect(clonedEmote?.style.width).toBe('24px');
    expect(clonedEmote?.style.height).toBe('24px');
    expect(clonedEmote?.style.objectFit).toBe('contain');
    expect(clonedEmote?.style.opacity).toBe('');
    expect(clonedEmote?.style.position).toBe('');
    expect(clonedEmote?.alt).toBe('BLOCKEMOTE');
    expect(clonedEmote?.title).toBe('BLOCKEMOTE');

    // The live Kick node is never mutated.
    expect(nativeContent.classList.contains('line-clamp-2')).toBe(true);
    expect(nativeContent.hidden).toBe(true);
    expect(emote.classList.contains('absolute')).toBe(true);
    expect(emote.style.opacity).toBe('0');
  });

  it('sanitises every element when the clone root is a document fragment', () => {
    const fragment = document.createDocumentFragment();
    const block = document.createElement('div');
    block.className = 'keep line-clamp-12 max-h-0';
    fragment.append(block);

    const clone = cloneSanitizedNativeDom(fragment);

    expect(clone.querySelector('div')?.className).toBe('keep');
    expect(block.className).toBe('keep line-clamp-12 max-h-0');
  });
});
