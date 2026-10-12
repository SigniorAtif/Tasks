import type { ISODate, OccurrenceKey } from '../types.ts';

/**
 * The identity of a generated occurrence: its series and the local date the rule produced
 * (D-022). It survives time changes, and anyone can compute it before a database row exists.
 */
export const occurrenceKey = (seriesId: string, originalDate: ISODate): OccurrenceKey =>
  `${seriesId}:${originalDate}`;

/** The identity of an extra occurrence (one the rule never generated): its override's id. */
export const extraKey = (overrideId: string): OccurrenceKey => `x:${overrideId}`;
