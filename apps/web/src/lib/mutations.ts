// The writes the screens make, as TanStack Query mutations. A mutation is a
// request that changes something on the server: it isn't cached like a read,
// but TanStack Query tracks whether it's running or failed, and what to do
// once it worked. Usually that's marking the cached reads the change makes out
// of date ("invalidating" them), so they're fetched again. A change to one
// occurrence instead gets the occurrence back and puts it straight into the
// cached calendar weeks, with no refetch.
//
// Writes are online-only (D-048): nothing is queued while offline, and the
// screens disable their buttons instead. The one exception is a change to one
// occurrence, which is queued (occurrence-queue.ts) so it works with no signal.

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CalendarResponse,
  type CreateGroup,
  type CreateSeries,
  type ISODate,
  type Occurrence,
  paths,
  type ScheduleGroup,
  type Series,
  type UpdateGroup,
  type UpdateOccurrence,
  type UpdateSeries,
} from '@tasks/core';
import { v7 as uuidv7 } from 'uuid';
import { ApiError, apiSend } from './api.ts';
import { groupsQuery, seriesListQuery } from './queries.ts';

/**
 * An id for a row the app is about to create: a UUIDv7, made here on the phone
 * rather than by the server (D-034). Make it once per thing being created and
 * keep it until the create has worked. If the answer is lost and the user taps
 * Save again, the same id goes again, and the server answers with the row it
 * already made instead of making a second one (D-042).
 */
export function newId(): string {
  return uuidv7();
}

/**
 * Marks every cached read a calendar write can change as out of date. Screens
 * showing them fetch again now; the rest fetch when they're next shown. The
 * returned promise waits for the refetches of what's on screen.
 */
export async function invalidateAfterWrite(
  queryClient: QueryClient,
  { groups = false }: { groups?: boolean } = {},
): Promise<void> {
  await Promise.all([
    // A prefix: every cached window, `['calendar', from, to]`, whatever its dates.
    queryClient.invalidateQueries({ queryKey: ['calendar'] }),
    queryClient.invalidateQueries({ queryKey: seriesListQuery.queryKey }),
    groups ? queryClient.invalidateQueries({ queryKey: groupsQuery.queryKey }) : undefined,
  ]);
}

// The requests themselves, as plain functions: easy to test without React.

/** `POST /api/v1/groups`. 201 with the new group, or 200 with the existing one for a repeated id. */
export function createGroup(input: CreateGroup): Promise<ScheduleGroup> {
  return apiSend<ScheduleGroup>('POST', paths.groups, input);
}

/** `PATCH /api/v1/groups/:id` with only the fields that changed. */
export function updateGroup({ id, changes }: { id: string; changes: UpdateGroup }) {
  return apiSend<ScheduleGroup>('PATCH', `${paths.groups}/${id}`, changes);
}

/** `POST /api/v1/series`. Same idempotent answer as `createGroup`. */
export function createSeries(input: CreateSeries): Promise<Series> {
  return apiSend<Series>('POST', paths.series, input);
}

/** `PATCH /api/v1/series/:id` with only the fields that changed. */
export function updateSeries({ id, changes }: { id: string; changes: UpdateSeries }) {
  return apiSend<Series>('PATCH', `${paths.series}/${id}`, changes);
}

/**
 * `DELETE /api/v1/series/:id`. A 404 counts as done: the class is gone either
 * way. That happens when an earlier try worked but its answer was lost, so the
 * user tapped Delete again.
 */
export async function deleteSeries(id: string): Promise<void> {
  try {
    await apiSend<undefined>('DELETE', `${paths.series}/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return;
    throw error;
  }
}

/** A change to one occurrence, named by its series and the date the rule generated (D-022). */
export interface OccurrenceChange {
  seriesId: string;
  originalDate: ISODate;
  change: UpdateOccurrence;
}

/**
 * `PATCH /api/v1/occurrences/:seriesId/:originalDate`: cancel, restore or change the
 * reason. Answers with the occurrence as the server now computes it. Sending the
 * same change twice is harmless.
 */
export function changeOccurrence({
  seriesId,
  originalDate,
  change,
}: OccurrenceChange): Promise<Occurrence> {
  return apiSend<Occurrence>('PATCH', `${paths.occurrences}/${seriesId}/${originalDate}`, change);
}

/**
 * Puts an occurrence the server sent into every cached calendar window that
 * shows it, in place of the old copy. Windows without it are left alone, so
 * nothing is fetched again.
 */
export function putOccurrence(queryClient: QueryClient, occurrence: Occurrence): void {
  queryClient.setQueriesData<CalendarResponse>({ queryKey: ['calendar'] }, (window) => {
    if (!window?.occurrences.some((o) => o.key === occurrence.key)) return window;
    return {
      ...window,
      occurrences: window.occurrences.map((o) => (o.key === occurrence.key ? occurrence : o)),
    };
  });
}

// The hooks the screens use. Returning the invalidation from `onSuccess` keeps
// the mutation "pending" until the refetches of what's on screen are back, so
// a screen never shows the old data after saying "saved".

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: () => invalidateAfterWrite(queryClient, { groups: true }),
  });
}

/** A group's colour and last day show on the calendar, so the weeks are fetched again too. */
export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateGroup,
    onSuccess: () => invalidateAfterWrite(queryClient, { groups: true }),
  });
}

export function useCreateSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSeries,
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

export function useUpdateSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSeries,
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

export function useDeleteSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSeries,
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}
