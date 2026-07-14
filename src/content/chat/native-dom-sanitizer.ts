const LEAKED_NATIVE_CLASS_PATTERNS = [
  /^line-clamp(?:-.+)?$/,
  /^truncate$/,
  /^text-(?:clip|ellipsis)$/,
  /^max-[hw]-.+$/,
  /^whitespace-(?:nowrap|pre|pre-line|pre-wrap)$/,
  /^(?:hidden|invisible|sr-only)$/,
  /^opacity-(?:0|\[0(?:\.0+)?\])$/,
  /^(?:absolute|fixed|sticky)$/,
  /^overflow(?:-[xy])?-(?:auto|clip|hidden|scroll)$/,
  /^leading-.+$/,
  /^aspect-.+$/,
  /^animate-.+$/,
  /^transition(?:-.+)?$/,
  /^(?:delay|duration|ease)-.+$/,
  /^(?:inset|top|right|bottom|left|z)-.+$/,
  /^(?:translate-[xy]|scale|rotate|skew-[xy])-.+$/,
  /^transform(?:-.+)?$/,
  /^\[(?:animation|aspect-ratio|display|height|line-height|max-height|max-width|opacity|overflow|position|transform|transition|visibility|width):.+\]$/,
];

const FIXED_SIZE_CLASS = /^[hw]-(?!auto$|fit$|min$|max$).+$/;
const FIXED_COMBINED_SIZE_CLASS = /^size-(?!auto$|fit$|min$|max$).+$/;
const SAFE_MEDIA_SIZE_CLASS = /^(?:[hw]|size)-(?:px|(?:0?\.(?:0*[1-9]\d*)|[1-9]\d*(?:\.\d+)?))$/;
const SAFE_MEDIA_INLINE_SIZE = /^(?:auto|(?:0?\.(?:0*[1-9]\d*)|[1-9]\d*(?:\.\d+)?)(?:em|px|rem))$/;
const MEDIA_ELEMENT_SELECTOR = 'img, svg, video, canvas';

const LEAKED_NATIVE_STYLE_PROPERTIES = [
  'animation',
  'animation-delay',
  'animation-direction',
  'animation-duration',
  'animation-fill-mode',
  'animation-iteration-count',
  'animation-name',
  'animation-play-state',
  'animation-timing-function',
  'aspect-ratio',
  'bottom',
  'clip',
  'clip-path',
  'display',
  'inset',
  'inset-block',
  'inset-inline',
  'left',
  'line-height',
  'max-height',
  'max-width',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'right',
  'rotate',
  'scale',
  'text-overflow',
  'top',
  'transform',
  'transition',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'translate',
  'visibility',
  'white-space',
  'z-index',
  '-webkit-box-orient',
  '-webkit-line-clamp',
] as const;

function utilityName(className: string): string {
  let bracketDepth = 0;
  let variantSeparator = -1;
  for (let index = 0; index < className.length; index += 1) {
    if (className[index] === '[') bracketDepth += 1;
    else if (className[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (className[index] === ':' && bracketDepth === 0) variantSeparator = index;
  }
  const utility = variantSeparator >= 0 ? className.slice(variantSeparator + 1) : className;
  return utility.startsWith('!') ? utility.slice(1) : utility;
}

function isLeakedNativeClass(element: Element, className: string): boolean {
  const utility = utilityName(className);
  if (LEAKED_NATIVE_CLASS_PATTERNS.some((pattern) => pattern.test(utility))) return true;
  if (!FIXED_SIZE_CLASS.test(utility) && !FIXED_COMBINED_SIZE_CLASS.test(utility)) return false;
  return !element.matches(MEDIA_ELEMENT_SELECTOR) || !SAFE_MEDIA_SIZE_CLASS.test(utility);
}

/**
 * Neutralize Kick presentation state on detached content before it enters a KickFlow surface.
 * Semantic/data attributes, typography/color classes, links, and media dimensions are retained;
 * hiding, clamping, positioning, clipping, and animation state belong to Kick's original layout.
 */
export function stripLeakedNativePresentation(root: Node): void {
  const elements = root instanceof Element
    ? [root, ...root.querySelectorAll('*')]
    : Array.from(root.childNodes).flatMap((child) => (
      child instanceof Element ? [child, ...child.querySelectorAll('*')] : []
    ));

  for (const element of elements) {
    for (const className of Array.from(element.classList)) {
      if (isLeakedNativeClass(element, className)) element.classList.remove(className);
    }

    element.removeAttribute('hidden');
    element.removeAttribute('inert');
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
    for (const property of LEAKED_NATIVE_STYLE_PROPERTIES) element.style.removeProperty(property);
    if (!element.matches(MEDIA_ELEMENT_SELECTOR)) {
      element.style.removeProperty('height');
      element.style.removeProperty('width');
    } else {
      for (const property of ['height', 'width'] as const) {
        if (!SAFE_MEDIA_INLINE_SIZE.test(element.style.getPropertyValue(property).trim())) {
          element.style.removeProperty(property);
        }
      }
    }
    if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
  }
}

export function cloneSanitizedNativeDom<T extends Node>(source: T): T {
  const clone = source.cloneNode(true) as T;
  stripLeakedNativePresentation(clone);
  return clone;
}
