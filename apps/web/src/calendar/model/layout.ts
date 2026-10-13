// Step 2 of drawing: when blocks on one day overlap in time, put them side by
// side in columns. This is interval partitioning (see the vault note of that
// name): use as few columns as possible, which is exactly the largest number
// of blocks that overlap at any one moment.
//
// 1. Cancelled occurrences go to a background layer. They're "freed time", so
//    they never take a column: drawn full width behind, striped (D-077).
// 2. The rest are swept in start order into clusters: groups linked by
//    overlaps. A block that starts when (or after) everything so far has
//    ended begins a new cluster. Touching is not overlapping: 09:00–10:00 and
//    10:00–11:00 each get the full width.
// 3. Inside a cluster, each block takes the first column that is free by its
//    start. Taking blocks in start order makes this greedy choice optimal.
// 4. Each block then stretches right over neighbouring columns that have
//    nothing overlapping it, so no space is wasted.

import { compareSegments, type Segment } from './segments.ts';

/** A segment with its place in the day column. */
export interface Positioned extends Segment {
  /** `background`: a cancelled occurrence, drawn full width behind the rest. */
  layer: 'background' | 'foreground';
  /** Which column it starts in, counting from 0 on the left. */
  col: number;
  /** How many columns its cluster has. The block's width is `span / cols` of the day. */
  cols: number;
  /** How many columns it covers, from `col` rightwards. At least 1. */
  span: number;
  /**
   * Its cluster overlaps a cancelled block, so the cluster is drawn a little
   * narrower to keep the stripes behind it visible (D-077). Always `false`
   * on the background layer.
   */
  overCancelled: boolean;
}

const overlaps = (a: Segment, b: Segment) => a.startMin < b.endMin && b.startMin < a.endMin;

/**
 * Lays out the segments of one day. The result is in `compareSegments` order
 * (by start time), whatever order the input came in, so the same day always
 * draws the same way.
 */
export function layoutDay(segments: readonly Segment[]): Positioned[] {
  const sorted = [...segments].sort(compareSegments);
  const background = sorted.filter((s) => s.occ.status === 'cancelled');
  const foreground = sorted.filter((s) => s.occ.status !== 'cancelled');

  const out: Positioned[] = background.map((s) => ({
    ...s,
    layer: 'background',
    col: 0,
    cols: 1,
    span: 1,
    overCancelled: false,
  }));

  let cluster: Segment[] = [];
  let clusterEnd = 0;
  for (const s of foreground) {
    if (cluster.length > 0 && s.startMin >= clusterEnd) {
      // Everything in the cluster has ended by now: it's complete.
      out.push(...packCluster(cluster, background));
      cluster = [];
    }
    if (cluster.length === 0) clusterEnd = s.endMin;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.endMin);
  }
  if (cluster.length > 0) out.push(...packCluster(cluster, background));

  return out.sort(compareSegments);
}

/** Columns for one cluster of overlapping foreground segments, already in start order. */
function packCluster(cluster: Segment[], background: Segment[]): Positioned[] {
  // `columnEnds[i]` is when the last block placed in column i ends.
  const columnEnds: number[] = [];
  const placed = cluster.map((s) => {
    let col = columnEnds.findIndex((end) => end <= s.startMin);
    if (col === -1) {
      col = columnEnds.length; // every column is busy: open a new one
      columnEnds.push(s.endMin);
    } else {
      columnEnds[col] = s.endMin;
    }
    return { s, col };
  });

  const cols = columnEnds.length;
  const overCancelled = cluster.some((s) => background.some((b) => overlaps(s, b)));

  return placed.map(({ s, col }) => {
    let span = 1;
    while (col + span < cols && !placed.some((p) => p.col === col + span && overlaps(p.s, s))) {
      span++;
    }
    return { ...s, layer: 'foreground', col, cols, span, overCancelled };
  });
}
