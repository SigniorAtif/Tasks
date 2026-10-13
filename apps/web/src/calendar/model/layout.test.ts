import { describe, expect, it } from 'vitest';
import { layoutDay, type Positioned } from './layout.ts';
import type { Segment } from './segments.ts';
import { segment } from './test-builders.ts';

/** Each block as `title col/cols span`, e.g. `'A 0/2 1'`; background blocks end in `bg`. */
const placement = (blocks: Positioned[]) =>
  blocks.map((b) =>
    b.layer === 'background' ? `${b.occ.title} bg` : `${b.occ.title} ${b.col}/${b.cols} ${b.span}`,
  );

const cancelled = { status: 'cancelled', cancelReason: 'not_held' } as const;

describe('layoutDay', () => {
  it('gives blocks that do not overlap the full width', () => {
    const day = [segment('A', '08:00', '09:00'), segment('B', '11:00', '12:00')];
    expect(placement(layoutDay(day))).toEqual(['A 0/1 1', 'B 0/1 1']);
  });

  it('treats touching blocks as separate: 09:00–10:00 then 10:00–11:00 (09 §7 L2)', () => {
    const day = [segment('A', '09:00', '10:00'), segment('B', '10:00', '11:00')];
    expect(placement(layoutDay(day))).toEqual(['A 0/1 1', 'B 0/1 1']);
  });

  it('needs three columns for three blocks at the same time (09 §7 L3)', () => {
    const day = [
      segment('A', '14:00', '15:00'),
      segment('B', '14:00', '15:00'),
      segment('C', '14:00', '15:00'),
    ];
    expect(placement(layoutDay(day))).toEqual(['A 0/3 1', 'B 1/3 1', 'C 2/3 1']);
  });

  it('uses two columns for a chain A–B, B–C where A and C never meet (09 §7 L1)', () => {
    const day = [
      segment('A', '10:00', '11:00'),
      segment('B', '10:30', '11:30'),
      segment('C', '11:00', '12:00'),
    ];
    // One cluster (B links A and C), but C reuses A's column once A has ended.
    expect(placement(layoutDay(day))).toEqual(['A 0/2 1', 'B 1/2 1', 'C 0/2 1']);
  });

  it('puts the longer of two blocks with the same start first (09 §7 L4)', () => {
    const day = [
      segment('B', '09:00', '10:00'),
      segment('A', '09:00', '12:00'),
      segment('C', '10:30', '11:30'),
    ];
    // C takes B's column, free again from 10:00.
    expect(placement(layoutDay(day))).toEqual(['A 0/2 1', 'B 1/2 1', 'C 1/2 1']);
  });

  it('stretches a block over a neighbouring column that is free for its whole length', () => {
    const day = [
      segment('A', '09:00', '11:00'),
      segment('B', '09:00', '10:00'),
      segment('C', '09:00', '10:00'),
      segment('D', '10:00', '11:00'),
    ];
    // D lands in B's column; C's column is empty from 10:00, so D covers it too.
    expect(placement(layoutDay(day))).toEqual(['A 0/3 1', 'B 1/3 1', 'C 2/3 1', 'D 1/3 2']);
  });

  it('never gives a cancelled block a column (09 §7 L5)', () => {
    const day = [segment('Class', '10:00', '11:00', cancelled), segment('Club', '10:00', '11:00')];
    const blocks = layoutDay(day);
    expect(placement(blocks)).toEqual(['Class bg', 'Club 0/1 1']);
    // The club meeting is drawn a little narrower so the stripes stay visible.
    expect(blocks.find((b) => b.occ.title === 'Club')?.overCancelled).toBe(true);
  });

  it('keeps the full width for clusters that do not touch a cancelled block', () => {
    const day = [segment('Class', '10:00', '11:00', cancelled), segment('Lab', '14:00', '16:00')];
    expect(layoutDay(day).map((b) => b.overCancelled)).toEqual([false, false]);
  });

  it('puts overlapping cancelled blocks all in the background', () => {
    const day = [
      segment('A', '10:00', '11:00', cancelled),
      segment('B', '10:00', '11:00', { status: 'cancelled', cancelReason: 'skipped' }),
    ];
    expect(placement(layoutDay(day))).toEqual(['A bg', 'B bg']);
  });

  it('returns the same layout whatever order the segments arrive in', () => {
    const day = [
      segment('A', '09:00', '11:00'),
      segment('B', '09:00', '10:00'),
      segment('C', '09:00', '10:00'),
      segment('D', '10:00', '11:00'),
      segment('E', '10:00', '11:00', cancelled),
    ];
    const expected = layoutDay(day);
    for (const order of [
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
      [1, 3, 0, 4, 2],
    ]) {
      expect(layoutDay(order.map((i) => day[i] as Segment))).toEqual(expected);
    }
  });

  it('keeps its promises on 500 random days', () => {
    // A tiny seeded random generator, so a failure always reproduces.
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    const wall = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    const overlaps = (a: Segment, b: Segment) => a.startMin < b.endMin && b.startMin < a.endMin;
    const columnsOf = (b: Positioned) => Array.from({ length: b.span }, (_, k) => b.col + k);

    for (let run = 0; run < 500; run++) {
      const day = Array.from({ length: 1 + random(12) }, (_, i) => {
        const start = random(48) * 30; // on the half hour, so ties and touches are common
        const end = Math.min(start + 15 + random(8) * 15, 1440);
        return segment(`S${i}`, wall(start), wall(end), random(5) === 0 ? cancelled : {});
      });
      const blocks = layoutDay(day).filter((b) => b.layer === 'foreground');

      for (const a of blocks) {
        // Overlapping blocks never share a column, stretched spans included.
        for (const b of blocks) {
          if (b === a || !overlaps(a, b)) continue;
          expect(columnsOf(a).some((c) => columnsOf(b).includes(c))).toBe(false);
        }

        // As few columns as possible: a's cluster (everything linked to it by
        // overlaps) has exactly as many columns as the most of its blocks
        // that are on at one moment. For intervals, that moment is a start.
        const cluster = new Set([a]);
        const queue = [a];
        for (let x = queue.pop(); x !== undefined; x = queue.pop()) {
          for (const b of blocks) {
            if (!cluster.has(b) && overlaps(x, b)) {
              cluster.add(b);
              queue.push(b);
            }
          }
        }
        const members = [...cluster];
        const depth = Math.max(
          ...members.map(
            (c) => members.filter((b) => b.startMin <= c.startMin && c.startMin < b.endMin).length,
          ),
        );
        expect(a.cols).toBe(depth);
        expect(a.col + a.span).toBeLessThanOrEqual(a.cols);
      }
    }
  });
});
