import { useRouter } from '@tanstack/react-router';
import type { ISODate, ScheduleGroup, Series } from '@tasks/core';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ColorSwatches,
  describedBy,
  Field,
  FieldNotes,
  FormBanner,
  inputClass,
  OFFLINE_NOTE_ID,
  SaveRow,
} from '../components/form-controls.tsx';
import { ApiError, describeSaveError } from '../lib/api.ts';
import { hasProblems, mergeProblems, NO_PROBLEMS } from '../lib/form-problems.ts';
import {
  newId,
  useCreateGroup,
  useCreateSeries,
  useDeleteSeries,
  useUpdateSeries,
} from '../lib/mutations.ts';
import { useFormProblems } from '../lib/use-form-problems.ts';
import { useSyncStatus } from '../lib/use-sync-status.ts';
import { DayToggles } from './controls.tsx';
import {
  blankValues,
  changedFields,
  checkCreateSeries,
  checkGroup,
  checkUpdateSeries,
  type FieldName,
  firstProblemField,
  isArchived,
  LABELS,
  NEW_GROUP,
  problemsFromErrors,
  type SeriesFormValues,
  selectableGroups,
  toCreateGroup,
  toCreateSeries,
  toFullUpdate,
  valuesFromSeries,
  withGroupChosen,
} from './form-values.ts';

const HINTS = {
  title: 'The short name on the calendar, like “DS”.',
  subject: 'Attendance is counted by subject. Leave it empty to use the title.',
  location: 'Optional. A room, like C-301.',
  groupName: 'Like “Classes · Sem 3”.',
  untilDate: 'Optional. Empty means until the group ends.',
};

/** The banner's title when the class was deleted elsewhere (a 404). */
const CLASS_GONE = "This class doesn't exist any more";

/** Quick picks next to the minutes box: the usual class and lab lengths. */
const QUICK_DURATIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
];

/**
 * The form to add a class (`series` is `null`) or change one. Checks what was
 * typed with the API's own schemas before sending anything, creates a new group
 * first when one was asked for, and goes back to the calendar once it's saved.
 */
export function SeriesForm({
  series,
  groups,
  seriesList = [],
  today,
}: {
  series: Series | null;
  groups: readonly ScheduleGroup[];
  /** Every series, for a new class: its first day suggests the earliest future first day in its group. */
  seriesList?: readonly Series[];
  /** Today in the user's zone: the default first day. */
  today: ISODate;
}) {
  const router = useRouter();
  // Writes are online-only in v0.2 (D-048): Save and Delete are off while the
  // badge says offline, rather than failing after a tap.
  const online = useSyncStatus().state !== 'offline';
  // What the form started with: an edit sends only what differs from it.
  const [initial] = useState(() =>
    series === null ? blankValues(today, groups, seriesList) : valuesFromSeries(series),
  );
  const [values, setValues] = useState<SeriesFormValues>(initial);
  const { problems, failure, banner, register, reset, clearProblem, showProblems, showFailure } =
    useFormProblems<FieldName>(firstProblemField);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Ids for the rows this form creates: made on the first Save and kept, so
  // pressing Save again after a failure re-sends the same ids (D-042).
  const pendingIds = useRef<{ group?: string; series?: string }>({});

  const createGroup = useCreateGroup();
  const createSeries = useCreateSeries();
  const updateSeries = useUpdateSeries();
  const deleteSeries = useDeleteSeries();
  const saving = createGroup.isPending || createSeries.isPending || updateSeries.isPending;
  const busy = saving || deleteSeries.isPending;

  const choices = selectableGroups(groups, today, series?.groupId);
  const makingGroup = values.groupId === NEW_GROUP;
  const errors = problems.fields;

  function set<K extends Exclude<keyof SeriesFormValues, 'newGroup'>>(
    key: K,
    value: SeriesFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
    clearProblem(key);
  }
  function setNewGroup(change: Partial<SeriesFormValues['newGroup']>) {
    setValues((v) => ({ ...v, newGroup: { ...v.newGroup, ...change } }));
    if (change.name !== undefined) clearProblem('groupName');
    if (change.colorToken !== undefined) clearProblem('groupColor');
  }
  /** A new class's first day follows the group picked, until the user changes it. */
  function chooseGroup(groupId: string) {
    if (series === null) {
      setValues((v) => withGroupChosen(v, groupId, seriesList, today));
      clearProblem('groupId');
    } else {
      set('groupId', groupId);
    }
  }
  /** The id for the group or series this form creates: the same one on every try. */
  function pendingId(kind: 'group' | 'series'): string {
    const id = pendingIds.current[kind] ?? newId();
    pendingIds.current[kind] = id;
    return id;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !online) return;
    reset();

    const groupId = makingGroup ? pendingId('group') : values.groupId;

    // Check everything before sending anything.
    const groupBody = makingGroup ? toCreateGroup(values, groupId) : null;
    const createBody =
      series === null
        ? toCreateSeries(values, { series: pendingId('series'), group: groupId })
        : null;
    const found = mergeProblems(
      groupBody === null ? NO_PROBLEMS : checkGroup(groupBody),
      createBody === null
        ? checkUpdateSeries(toFullUpdate(values, groupId))
        : checkCreateSeries(createBody),
    );
    if (hasProblems(found)) return showProblems(found);

    let step: 'group' | 'series' = 'group';
    try {
      if (groupBody !== null) await createGroup.mutateAsync(groupBody);
      step = 'series';
      if (createBody !== null) {
        await createSeries.mutateAsync(createBody);
      } else if (series !== null) {
        const changes = changedFields(values, initial, groupId);
        if (Object.keys(changes).length > 0) {
          await updateSeries.mutateAsync({ id: series.id, changes });
        }
      }
    } catch (error) {
      // The server found something our check didn't: show it on the field too.
      if (error instanceof ApiError && error.code === 'validation_failed' && error.errors.length) {
        return showProblems(problemsFromErrors(error.errors, step));
      }
      // The id is already used by a row we can't see (with UUIDv7, practically
      // never): make a new one for the next try.
      if (error instanceof ApiError && error.code === 'conflict') delete pendingIds.current[step];
      return showFailure(error);
    }
    // The calendar refetches by itself: the save invalidated it.
    await router.navigate({ to: '/' });
  }

  async function remove() {
    if (series === null || busy || !online) return;
    reset();
    try {
      await deleteSeries.mutateAsync(series.id);
    } catch (error) {
      return showFailure(error);
    }
    await router.navigate({ to: '/' });
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-5">
      <FormBanner
        ref={banner}
        failure={failure === null ? null : describeSaveError(failure, CLASS_GONE)}
        other={problems.other}
      />

      <Field id="series-title" label={LABELS.title} hint={HINTS.title} error={errors.title}>
        <input
          id="series-title"
          ref={register('title')}
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          autoComplete="off"
          className={inputClass}
          {...describedBy('series-title', { hint: HINTS.title, error: errors.title })}
        />
      </Field>

      <Field id="series-subject" label={LABELS.subject} hint={HINTS.subject} error={errors.subject}>
        <input
          id="series-subject"
          ref={register('subject')}
          value={values.subject}
          // Follows the title until the user types a subject of their own.
          placeholder={values.title.trim() === '' ? 'Same as the title' : values.title}
          onChange={(e) => set('subject', e.target.value)}
          autoComplete="off"
          className={inputClass}
          {...describedBy('series-subject', { hint: HINTS.subject, error: errors.subject })}
        />
      </Field>

      <Field
        id="series-location"
        label={LABELS.location}
        hint={HINTS.location}
        error={errors.location}
      >
        <input
          id="series-location"
          ref={register('location')}
          value={values.location}
          onChange={(e) => set('location', e.target.value)}
          autoComplete="off"
          className={inputClass}
          {...describedBy('series-location', { hint: HINTS.location, error: errors.location })}
        />
      </Field>

      {choices.length > 0 && (
        <Field id="series-group" label={LABELS.groupId} error={errors.groupId}>
          <select
            id="series-group"
            ref={register('groupId')}
            value={values.groupId}
            onChange={(e) => chooseGroup(e.target.value)}
            className={inputClass}
            {...describedBy('series-group', { error: errors.groupId })}
          >
            {choices.map((group) => (
              <option key={group.id} value={group.id}>
                {isArchived(group, today) ? `${group.name} (archived)` : group.name}
              </option>
            ))}
            <option value={NEW_GROUP}>New group…</option>
          </select>
        </Field>
      )}

      {makingGroup && (
        <fieldset className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-slate-200 dark:ring-slate-800">
          <legend className="px-1 text-sm font-semibold">New group</legend>
          {choices.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Every class belongs to a group, such as a semester. Make your first one here; it's
              saved together with the class.
            </p>
          )}
          <Field
            id="group-name"
            label={LABELS.groupName}
            hint={HINTS.groupName}
            error={errors.groupName}
          >
            <input
              id="group-name"
              ref={register('groupName')}
              value={values.newGroup.name}
              onChange={(e) => setNewGroup({ name: e.target.value })}
              autoComplete="off"
              className={inputClass}
              {...describedBy('group-name', { hint: HINTS.groupName, error: errors.groupName })}
            />
          </Field>
          <ColorSwatches
            id="group-color"
            label={LABELS.groupColor}
            value={values.newGroup.colorToken}
            onChange={(colorToken) => setNewGroup({ colorToken })}
            error={errors.groupColor}
            checkedRef={register('groupColor')}
          />
        </fieldset>
      )}

      <DayToggles
        id="series-days"
        label={LABELS.days}
        days={values.days}
        onChange={(days) => set('days', days)}
        error={errors.days}
        firstRef={register('days')}
      />

      <Field id="series-interval" label={LABELS.interval} error={errors.interval}>
        <select
          id="series-interval"
          ref={register('interval')}
          value={values.interval}
          onChange={(e) => set('interval', Number(e.target.value))}
          className={inputClass}
          {...describedBy('series-interval', { error: errors.interval })}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'Every week' : `Every ${n} weeks`}
            </option>
          ))}
        </select>
      </Field>

      <Field id="series-start-time" label={LABELS.startTime} error={errors.startTime}>
        <input
          id="series-start-time"
          ref={register('startTime')}
          type="time"
          step={60}
          value={values.startTime}
          onChange={(e) => set('startTime', e.target.value)}
          className={inputClass}
          {...describedBy('series-start-time', { error: errors.startTime })}
        />
      </Field>

      <div>
        <label htmlFor="series-duration" className="mb-1 block text-sm font-medium">
          {LABELS.durationMin}
        </label>
        <div className="flex gap-2">
          <input
            id="series-duration"
            ref={register('durationMin')}
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={values.durationMin}
            onChange={(e) => set('durationMin', e.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
            {...describedBy('series-duration', { error: errors.durationMin })}
          />
          {QUICK_DURATIONS.map(({ minutes, label }) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={values.durationMin.trim() === String(minutes)}
              onClick={() => set('durationMin', String(minutes))}
              className="shrink-0 rounded-lg px-3 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white aria-pressed:ring-indigo-600 dark:ring-slate-700 dark:hover:bg-slate-800 dark:aria-pressed:bg-indigo-500"
            >
              {label}
            </button>
          ))}
        </div>
        <FieldNotes id="series-duration" error={errors.durationMin} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="series-start-date" label={LABELS.startDate} error={errors.startDate}>
          <input
            id="series-start-date"
            ref={register('startDate')}
            type="date"
            value={values.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            className={inputClass}
            {...describedBy('series-start-date', { error: errors.startDate })}
          />
        </Field>
        <Field
          id="series-until-date"
          label={LABELS.untilDate}
          hint={HINTS.untilDate}
          error={errors.untilDate}
        >
          <input
            id="series-until-date"
            ref={register('untilDate')}
            type="date"
            value={values.untilDate}
            min={values.startDate}
            onChange={(e) => set('untilDate', e.target.value)}
            className={inputClass}
            {...describedBy('series-until-date', {
              hint: HINTS.untilDate,
              error: errors.untilDate,
            })}
          />
        </Field>
      </div>

      <SaveRow saving={saving} disabled={busy || !online} offline={!online} cancelTo="calendar" />

      {series !== null && (
        <DeleteSection
          confirming={confirmingDelete}
          onConfirmingChange={setConfirmingDelete}
          onDelete={remove}
          deleting={deleteSeries.isPending}
          disabled={busy || !online}
          offline={!online}
        />
      )}
    </form>
  );
}

/**
 * Delete, in two steps without a pop-up: the first tap asks "Delete this
 * class?" in place, the second deletes. A mistaken tap costs nothing.
 */
function DeleteSection({
  confirming,
  onConfirmingChange,
  onDelete,
  deleting,
  disabled,
  offline,
}: {
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
  onDelete: () => void;
  deleting: boolean;
  disabled: boolean;
  offline: boolean;
}) {
  const keepButton = useRef<HTMLButtonElement>(null);
  // Moving to the question moves the focus to its safe answer.
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  const quiet =
    'rounded-lg px-4 py-2.5 font-medium ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <section
      aria-label="Delete this class"
      className="mt-2 border-t border-slate-200 pt-5 dark:border-slate-800"
    >
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="font-medium">Delete this class?</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Every week of it disappears from the calendar, past weeks too.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              aria-describedby={offline ? OFFLINE_NOTE_ID : undefined}
              className={`${quiet} flex-1 bg-red-600 text-white ring-red-600 hover:bg-red-700 dark:bg-red-500 dark:ring-red-500`}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              ref={keepButton}
              type="button"
              onClick={() => onConfirmingChange(false)}
              disabled={deleting}
              className={`${quiet} text-slate-700 ring-slate-300 hover:bg-slate-100 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800`}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onConfirmingChange(true)}
          disabled={disabled}
          aria-describedby={offline ? OFFLINE_NOTE_ID : undefined}
          className={`${quiet} w-full text-red-700 ring-red-200 hover:bg-red-50 dark:text-red-400 dark:ring-red-900 dark:hover:bg-red-950`}
        >
          Delete this class
        </button>
      )}
    </section>
  );
}
