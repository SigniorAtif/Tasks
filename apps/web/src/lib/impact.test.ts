import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hiddenChangesNote, impactQuery } from './impact.ts';

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

describe('impactQuery', () => {
  it("asks the server what a last day would hide in that group's or series' classes", async () => {
    const fetchMock = vi.fn(async () => Response.json({ changesAfter: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const impact = await new QueryClient().fetchQuery(
      impactQuery('/api/v1/groups/g', '2026-11-27'),
    );

    expect(impact).toEqual({ changesAfter: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/g/impact?lastDay=2026-11-27',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });
});
