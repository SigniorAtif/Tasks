import { COLOR_TOKENS } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import { groupColor, isColorToken, paletteVar } from './palette.ts';

describe('palette', () => {
  it('names one CSS variable per token', () => {
    expect(paletteVar('teal')).toBe('--palette-teal');
    expect(groupColor('teal')).toBe('var(--palette-teal)');
    expect(COLOR_TOKENS.every(isColorToken)).toBe(true);
  });

  it('falls back to neutral for a missing or unknown token', () => {
    expect(isColorToken('magenta')).toBe(false);
    expect(groupColor('magenta')).toBe('var(--palette-neutral)');
    expect(groupColor(undefined)).toBe('var(--palette-neutral)');
  });
});
