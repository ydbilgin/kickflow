import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Reads the production stylesheet straight out of `bootstrap.ts`. Style guards must assert against
 * what ships, not against a copy that can drift away from it. */
export function styleTemplate(): string {
  const source = readFileSync(resolve(process.cwd(), 'src/content/bootstrap.ts'), 'utf8')
    .replace(/\r\n?/g, '\n');
  const marker = 'const css = `';
  const start = source.indexOf(marker);
  const end = source.indexOf('`;\n  adoptedStyleSheet = installStyleSheet(css);', start + marker.length);
  if (start < 0 || end < 0) throw new Error('bootstrap style template not found');
  return source.slice(start + marker.length, end);
}

/** Declarations of one rule, by exact selector.
 *
 * Two things this must get right, both learned from real misses:
 * - The selector is anchored to the start of a rule. Unanchored, `.kickflow-emote-box` also matches
 *   inside `.kickflow-user-messages__reply .kickflow-emote-box` and silently returns whichever came
 *   first in the file, so the guard asserts against a scoped override instead of the base rule.
 * - The body may contain `${...}` interpolations, whose closing brace would otherwise end the match
 *   early and hide every declaration after it. */
export function declarations(selector: string): string {
  const css = styleTemplate();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{((?:\\$\\{[^}]*\\}|[^}])*)\\}`));
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1].replace(/\s+/g, ' ').trim();
}
