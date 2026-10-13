import { describe, expect, it } from 'vitest';
import { msUntilNextMinute } from './use-server-minute.ts';

const at = (iso: string) => Date.parse(iso);

describe('msUntilNextMinute', () => {
  it('counts down to the next whole minute', () => {
    expect(msUntilNextMinute(at('2026-10-13T08:35:40.000Z'))).toBe(20_000);
    expect(msUntilNextMinute(at('2026-10-13T08:35:59.999Z'))).toBe(1);
  });

  it('waits a full minute when it is exactly on the minute', () => {
    expect(msUntilNextMinute(at('2026-10-13T08:35:00.000Z'))).toBe(60_000);
  });

  it('works for India too: +05:30 shifts the hour, never the minute boundary', () => {
    // Every zone's minutes change at the same instant as UTC's, so no zone is needed.
    expect(msUntilNextMinute(at('2026-10-13T14:05:40+05:30'))).toBe(20_000);
  });
});
