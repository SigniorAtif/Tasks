import { describe, expect, it } from 'vitest';
import { nameMatches } from './name-match.ts';

describe('nameMatches', () => {
  it('ignores case, spaces and symbols', () => {
    expect(nameMatches('Classes · Sem 3', 'classes sem 3')).toBe(true);
    expect(nameMatches('Classes · Sem 3', 'CLASSESSEM3')).toBe(true);
    expect(nameMatches('Classes · Sem 3', '  Classes - Sem 3!  ')).toBe(true);
  });

  it('refuses another name, a part of the name and an empty input', () => {
    expect(nameMatches('Classes · Sem 3', 'classes sem 4')).toBe(false);
    expect(nameMatches('Classes · Sem 3', 'classes')).toBe(false);
    expect(nameMatches('Classes · Sem 3', '')).toBe(false);
    expect(nameMatches('Classes · Sem 3', ' · ')).toBe(false);
  });

  it('keeps the letters and digits of any script', () => {
    expect(nameMatches('Математика · 2', 'математика 2')).toBe(true);
    expect(nameMatches('Математика · 2', 'математика 3')).toBe(false);
    expect(nameMatches('رياضيات ٣', 'رياضيات٣')).toBe(true);
    expect(nameMatches('数学 (月曜)', '数学月曜')).toBe(true);
    expect(nameMatches('数学 (月曜)', '数学')).toBe(false);
  });

  it('compares the letters of a script with vowel marks, not the marks', () => {
    expect(nameMatches('गणित', 'गणित')).toBe(true);
    expect(nameMatches('गणित', 'गणत')).toBe(true);
    expect(nameMatches('गणित', 'गण')).toBe(false);
  });

  it('matches an accent typed as its own character', () => {
    // "é" as one character against "e" followed by a combining acute.
    expect(nameMatches('Café', 'café')).toBe(true);
  });

  it('wants an emoji-only name typed exactly, give or take the spaces around it', () => {
    expect(nameMatches('🏋️', '🏋️')).toBe(true);
    expect(nameMatches(' 🏋️ ', '🏋️  ')).toBe(true);
    expect(nameMatches('🏋️', '')).toBe(false);
    expect(nameMatches('🏋️', '   ')).toBe(false);
    expect(nameMatches('🏋️', '🎉')).toBe(false);
    expect(nameMatches('🏋️', '!!!')).toBe(false);
  });
});
