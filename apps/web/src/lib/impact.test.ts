import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hiddenChangesNote, impactQuery, seriesChangeNotes } from './impact.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hiddenChangesNote', () => {
  it('says how many changes a last day hides, and that a later date brings them back', () => {
    expect(hiddenChangesNote(3, '2026-11-27')).toBe(
      '3 changes after 27 Nov 2026 will stop showing. A later date brings them back.',
    );
    expect(hiddenChangesNote(1, '2026-11-27')).toBe(
      '1 change after 27 Nov 2026 will stop showing. A later date brings it back.',
    );
  });

  it('says nothing when the last day hides nothing', () => {
    expect(hiddenChangesNote(0, '2026-11-27')).toBeUndefined();
  });
});

describe('seriesChangeNotes', () => {
  it('words each warning for what was asked, by what it hides', () => {
    const impact = { changesAfter: 2, changesBefore: 1, changesOffTiming: 3 };
    expect(
      seriesChangeNotes(impact, {
        firstDay: '2026-10-01',
        lastDay: '2026-11-20',
        byDay: ['TU', 'TH'],
        interval: 1,
      }),
    ).toEqual({
      firstDay: '1 change before 1 Oct 2026 will stop showing. An earlier date brings it back.',
      lastDay: '2 changes after 20 Nov 2026 will stop showing. A later date brings them back.',
      timing:
        "3 changes on days the new timing doesn't produce will stop showing. The old timing brings them back.",
    });
  });

  it('says nothing about what hides nothing, or what was not asked', () => {
    const impact = { changesAfter: 3, changesBefore: 0, changesOffTiming: 0 };
    expect(seriesChangeNotes(impact, { firstDay: '2026-10-01' })).toEqual({});
  });

  it('warns under First day when a new first day alone moves the class off a change', () => {
    // Every 2 weeks counts from the first day's week: a week later, the class meets the other weeks.
    const impact = { changesAfter: 0, changesBefore: 1, changesOffTiming: 2 };
    expect(seriesChangeNotes(impact, { firstDay: '2026-07-20' })).toEqual({
      firstDay:
        '1 change before 20 Jul 2026 will stop showing. An earlier date brings it back. ' +
        '2 changes in weeks the class no longer meets will stop showing. The old first day brings them back.',
    });
  });
});

describe('impactQuery', () => {
  it("asks the server what a last day would hide in that group's or series' classes", async () => {
    const fetchMock = vi.fn(async () => Response.json({ changesAfter: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const impact = await new QueryClient().fetchQuery(
      impactQuery('/api/v1/groups/g', { lastDay: '2026-11-27' }),
    );

    expect(impact).toEqual({ changesAfter: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/g/impact?lastDay=2026-11-27',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it("asks about a series' new first day and timing in the same request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ changesAfter: 0, changesBefore: 1, changesOffTiming: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new QueryClient().fetchQuery(
      impactQuery('/api/v1/series/s', { firstDay: '2026-10-01', byDay: ['TU', 'TH'], interval: 1 }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/series/s/impact?firstDay=2026-10-01&byDay=TU%2CTH&interval=1',
      expect.anything(),
    );
  });
});
