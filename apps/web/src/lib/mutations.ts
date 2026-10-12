// The writes the screens make, as TanStack Query mutations. A mutation is a
// request that changes something on the server: it isn't cached like a read,
// but TanStack Query tracks whether it's running or failed, and what to do
// once it worked. Here that's always the same: mark the cached reads that the
// change makes out of date ("invalidate" them), so they're fetched again.
//
// Writes are online-only in v0.2 (D-048): nothing is queued while offline. The
// screens disable their Save buttons when offline instead.

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateGroup,
  type CreateSeries,
  paths,
  type ScheduleGroup,
  type Series,
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
