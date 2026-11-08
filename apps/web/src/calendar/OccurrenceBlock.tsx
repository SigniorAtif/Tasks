import type { IanaZone, Occurrence } from '@tasks/core';
import { cssVars } from './css-vars.ts';
import { blockDescription, statusLabel, timeRangeLabel } from './model/format.ts';
import type { Positioned } from './model/layout.ts';
import { groupColor } from './model/palette.ts';
import type { GridGroup } from './TimeGrid.tsx';

/** Below this height a block puts its title and time on one line. */
const SHORT_BLOCK_PX = 40;

/** One line of text in a block (time-grid.css: 1rem line height), and its top and bottom padding. */
const LINE_PX = 16;
const PADDING_PX = 4;

/**
 * One occurrence's piece on one day, as a button: tap or press Enter to open
 * it. Where it sits and how it looks are data attributes and CSS variables
 * read by time-grid.css; this component only decides the words.
 */
export function OccurrenceBlock({
  block,
  zone,
  group,
  pxPerMin,
  onOpen,
}: {
  block: Positioned;
  zone: IanaZone;
  group: GridGroup | undefined;
  pxPerMin: number;
  onOpen: ((occurrence: Occurrence) => void) | undefined;
}) {
  const { occ } = block;
  const cancelled = occ.status === 'cancelled';
  // The drawn height, as time-grid.css computes it (less a 2 px gap below).
  const heightPx = (block.endMin - block.startMin) * pxPerMin - 2;
  const short = heightPx < SHORT_BLOCK_PX;
  const description = blockDescription(occ, zone, group?.name);
  const status = statusLabel(occ);
  // The room is the last line: show it only if it fits whole, not half cut off.
  const linesWithRoom = status === null ? 3 : 4;
  const showLocation =
    occ.location !== null &&
    occ.location !== '' &&
    heightPx >= PADDING_PX + LINE_PX * linesWithRoom;

  return (
    <button
      type="button"
      className="tg-block"
      data-layer={block.layer}
      data-status={occ.status}
      // A cancellation with no reason (a group without attendance) looks "not held".
      data-reason={cancelled ? (occ.cancelReason ?? 'not_held') : undefined}
      data-short={short || undefined}
      data-over-cancelled={block.overCancelled || undefined}
      data-cut-before={block.continuesBefore || undefined}
      data-cut-after={block.continuesAfter || undefined}
      style={cssVars({
        '--start': block.startMin,
        '--len': block.endMin - block.startMin,
        '--col': block.col,
        '--cols': block.cols,
        '--span': block.span,
        '--c': groupColor(group?.colorToken),
      })}
      // The visible words can be a short code ("DS"); the label says it all.
      aria-label={description}
      title={description}
      onClick={() => onOpen?.(occ)}
    >
      {/* Most important first: a block too short for everything cuts off the
          bottom lines, and the room matters least (it's in the label too). */}
      <span className="tg-title">{occ.title}</span>
      <span className="tg-meta">
        {timeRangeLabel(Date.parse(occ.start), Date.parse(occ.end), zone)}
      </span>
      {status !== null && <span className={cancelled ? 'tg-pill' : 'tg-tag'}>{status}</span>}
      {showLocation && <span className="tg-meta">{occ.location}</span>}
    </button>
  );
}
