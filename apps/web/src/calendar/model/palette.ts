// Group colours. A group stores a token such as `teal` (from @tasks/core's
// COLOR_TOKENS), never a hex value. Each token is a CSS variable,
// `--palette-teal`, defined in src/index.css with one value for light mode and
// one for dark, both checked for contrast. So the colours can be retuned in
// one file without touching stored data, and dark mode needs no extra code.

import { COLOR_TOKENS, type ColorToken } from '@tasks/core';

/** The CSS variable that holds a token's colour: `--palette-teal`. */
export function paletteVar(token: ColorToken): `--palette-${ColorToken}` {
  return `--palette-${token}`;
}

/** Whether a stored value is one of the ten tokens. */
export function isColorToken(value: unknown): value is ColorToken {
  return (COLOR_TOKENS as readonly unknown[]).includes(value);
}

/**
 * The CSS colour for a group's token, ready for a `style`: `var(--palette-teal)`.
 * Anything else (no group, or a token this app version doesn't know yet) gets
 * a neutral grey instead of no colour at all.
 */
export function groupColor(token: string | undefined): string {
  return isColorToken(token) ? `var(${paletteVar(token)})` : 'var(--palette-neutral)';
}
