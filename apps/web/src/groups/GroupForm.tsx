import { useRouter } from '@tanstack/react-router';
import type { ScheduleGroup } from '@tasks/core';
import { type FormEvent, useRef, useState } from 'react';
import {
  ColorSwatches,
  describedBy,
  Field,
  FormBanner,
  inputClass,
  SaveRow,
} from '../components/form-controls.tsx';
import { ApiError, describeSaveError } from '../lib/api.ts';
import { hasProblems } from '../lib/form-problems.ts';
import { newId, useCreateGroup, useUpdateGroup } from '../lib/mutations.ts';
import { useFormProblems } from '../lib/use-form-problems.ts';
import { useSyncStatus } from '../lib/use-sync-status.ts';
import {
  blankGroupValues,
  checkGroupForm,
  firstGroupProblem,
  GROUP_LABELS,
  type GroupField,
  type GroupFormValues,
  groupChanges,
  groupCreateBody,
  groupProblemsFromErrors,
  valuesFromGroup,
} from './group-form.ts';

const HINTS = {
  name: 'Like “Classes · Sem 3” or “Health”.',
  attendance:
    'Cancelling a class asks why: Prof (it wasn’t held) or Me (I skipped it). Off, a cancel is just “Not today”.',
  untilDate:
    'Optional. Every class in the group ends on this day. Once it has passed, the group moves to Archived.',
};

/** The banner's title when the group was deleted elsewhere (a 404). */
const GROUP_GONE = "This group doesn't exist any more";

/**
 * The form to make a group (`group` is `null`) or change one: name, colour,
 * attendance and last day. Checks what was typed with the API's own schema
 * before sending anything, and goes back to Groups once it's saved. Archive
 * and Delete join it in later tickets (#12, #14), below the Save row.
 */
export function GroupForm({ group }: { group: ScheduleGroup | null }) {
  const router = useRouter();
  // Writes are online-only (D-048): Save is off while the badge says offline.
  const online = useSyncStatus().state !== 'offline';
  // What the form started with: an edit sends only what differs from it.
  const [initial] = useState(() => (group === null ? blankGroupValues() : valuesFromGroup(group)));
  const [values, setValues] = useState<GroupFormValues>(initial);
  const { problems, failure, banner, register, reset, clearProblem, showProblems, showFailure } =
    useFormProblems<GroupField>(firstGroupProblem);

  // The new group's id: made on the first Save and kept, so Save again after a
  // failure re-sends the same id and can't make a second group (D-042).
  const pendingId = useRef<string | undefined>(undefined);

  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const saving = createGroup.isPending || updateGroup.isPending;
  const errors = problems.fields;

  function set<K extends keyof GroupFormValues>(key: K, value: GroupFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Attendance is a checkbox: it can't be wrong, so it has no error to clear.
    if (key !== 'attendance') clearProblem(key as GroupField);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !online) return;
    reset();

    const found = checkGroupForm(values);
    if (hasProblems(found)) return showProblems(found);

    try {
      if (group === null) {
        pendingId.current ??= newId();
        await createGroup.mutateAsync(groupCreateBody(values, pendingId.current));
      } else {
        const changes = groupChanges(values, initial);
        if (Object.keys(changes).length > 0) {
          await updateGroup.mutateAsync({ id: group.id, changes });
        }
      }
    } catch (error) {
      // The server found something our check didn't: show it on the field too.
      if (error instanceof ApiError && error.code === 'validation_failed' && error.errors.length) {
        return showProblems(groupProblemsFromErrors(error.errors));
      }
      // The id is already used by a row we can't see (with UUIDv7, practically
      // never): make a new one for the next try.
      if (error instanceof ApiError && error.code === 'conflict') pendingId.current = undefined;
      return showFailure(error);
    }
    await router.navigate({ to: '/groups' });
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-5">
      <FormBanner
        ref={banner}
        failure={failure === null ? null : describeSaveError(failure, GROUP_GONE)}
        other={problems.other}
      />

      <Field id="group-name" label={GROUP_LABELS.name} hint={HINTS.name} error={errors.name}>
        <input
          id="group-name"
          ref={register('name')}
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          autoComplete="off"
          className={inputClass}
          {...describedBy('group-name', { hint: HINTS.name, error: errors.name })}
        />
      </Field>

      <ColorSwatches
        id="group-color"
        label={GROUP_LABELS.colorToken}
        value={values.colorToken}
        onChange={(colorToken) => set('colorToken', colorToken)}
        error={errors.colorToken}
        checkedRef={register('colorToken')}
      />

      <div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={values.attendance}
            onChange={(e) => set('attendance', e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            aria-describedby="group-attendance-hint"
          />
          <span className="font-medium">Count attendance</span>
        </label>
        <p
          id="group-attendance-hint"
          className="mt-1 pl-8 text-sm text-slate-500 dark:text-slate-400"
        >
          {HINTS.attendance}
        </p>
      </div>

      <Field
        id="group-until-date"
        label={GROUP_LABELS.untilDate}
        hint={HINTS.untilDate}
        error={errors.untilDate}
      >
        <input
          id="group-until-date"
          ref={register('untilDate')}
          type="date"
          value={values.untilDate}
          onChange={(e) => set('untilDate', e.target.value)}
          className={inputClass}
          {...describedBy('group-until-date', {
            hint: HINTS.untilDate,
            error: errors.untilDate,
          })}
        />
      </Field>

      <SaveRow saving={saving} disabled={saving || !online} offline={!online} cancelTo="groups" />
    </form>
  );
}
