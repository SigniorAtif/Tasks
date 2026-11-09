// These must pass whatever zone the test machine is in: `pnpm test:tz` runs
// them under UTC, Asia/Kolkata and America/New_York.
import { describe, expect, it } from 'vitest';
import { formatInZone, isKnownZone, serverNow, todayFor } from './time.ts';

const at = (iso: string) => Date.parse(iso);

describe('serverNow', () => {
  it('adds the time passed on this device since the reading', () => {
    expect(serverNow('2026-10-12T08:32:05Z', 1_000, 6_000)).toBe(at('2026-10-12T08:32:10Z'));
  });

  it('accepts an offset in the reading, not only Z', () => {
    expect(serverNow('2026-10-12T14:02:05+05:30', 0, 0)).toBe(at('2026-10-12T08:32:05Z'));
  });

  it('returns null for a reading that is not a timestamp', () => {
    expect(serverNow('not a time', 0, 0)).toBeNull();
  });
});

describe('formatInZone', () => {
  it('shows a UTC instant on an Indian wall clock (UTC+5:30, no daylight saving)', () => {
    const shown = formatInZone(at('2026-10-12T08:32:05Z'), 'Asia/Kolkata', 'en-GB');
    expect(shown.time).toBe('14:02:05');
    expect(shown.date).toContain('Monday');
    expect(shown.date).toContain('12 October 2026');
    expect(shown.offset).toBe('GMT+5:30');
    expect(shown.zone).toBe('Asia/Kolkata');
  });

  it('crosses midnight into the next local day', () => {
    // 20:00 UTC on the 12th is 01:30 on the 13th in India.
    const shown = formatInZone(at('2026-10-12T20:00:00Z'), 'Asia/Kolkata', 'en-GB');
    expect(shown.time).toBe('1:30:00');
    expect(shown.date).toContain('13 October 2026');
  });

  it('follows daylight saving: New York jumps from 01:59 to 03:00 on 2026-03-08', () => {
    const before = formatInZone(at('2026-03-08T06:59:00Z'), 'America/New_York', 'en-GB');
    const after = formatInZone(at('2026-03-08T07:00:00Z'), 'America/New_York', 'en-GB');
    expect(before).toMatchObject({ time: '1:59:00', offset: 'GMT-5' });
    expect(after).toMatchObject({ time: '3:00:00', offset: 'GMT-4' });
  });

  it('falls back to UTC for a zone this browser does not know', () => {
    const shown = formatInZone(at('2026-10-12T08:32:05Z'), 'Mars/Olympus_Mons', 'en-GB');
    expect(shown).toMatchObject({ time: '8:32:05', zone: 'UTC' });
    // Spelled `GMT` or `GMT+0` depending on the browser's time-zone data.
    expect(shown.offset).toMatch(/^GMT(\+0)?$/);
  });
});

describe('isKnownZone', () => {
  it('knows IANA names and rejects made-up ones', () => {
    expect(isKnownZone('Asia/Kolkata')).toBe(true);
    expect(isKnownZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('todayFor', () => {
  const kolkata = { tzid: 'Asia/Kolkata', dayBoundary: '04:00' };

  it("is the user's day in their zone, which starts at their day boundary", () => {
    // 20:00 UTC on the 12th is 01:30 on the 13th in Kolkata: still the 12th's night.
    expect(todayFor(kolkata, at('2026-10-12T20:00:00Z'))).toBe('2026-10-12');
    // 23:00 UTC is 04:30 in Kolkata: the 13th has begun.
    expect(todayFor(kolkata, at('2026-10-12T23:00:00Z'))).toBe('2026-10-13');
  });

  it("uses the phone's zone when this browser doesn't know the profile's", () => {
    const unknown = { tzid: 'Mars/Olympus_Mons', dayBoundary: '00:00' };
    const noon = at('2026-10-12T12:00:00Z');
    // en-CA writes dates as YYYY-MM-DD; with no timeZone, Intl uses the phone's.
    expect(todayFor(unknown, noon)).toBe(new Intl.DateTimeFormat('en-CA').format(noon));
  });
});
