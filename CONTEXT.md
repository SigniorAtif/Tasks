# Tasks

A personal calendar and task hub for a student: a recurring timetable that is
set up once, plus the changes life makes to single days (cancelled classes,
skipped runs, holidays).

## Language

### The calendar

**Group**:
A named set of series managed together, sharing a colour and an attendance setting, e.g. "Classes · Sem 3" or "Health".
_Avoid_: schedule group (the code's name only), calendar, category

**Attendance group**:
A group whose cancels record a reason (not held or skipped), so attendance can be counted per subject.
_Avoid_: class, course, lecture

**Series**:
One timing pattern, in a group or in no group, e.g. "Physics, Mon and Wed at 10:00 for 60 minutes".
_Avoid_: event, recurring item

**No group**:
Where a series sits when it belongs to no group, like "Feed the dog"; it has its own colour, never tracks attendance and isn't hit by holidays.
_Avoid_: default group, misc, other

**One-off**:
A series that happens once: one date, one start time, no repeat.
_Avoid_: event, appointment, single series

**Timing**:
A series' days, repeat interval, start time and duration.
_Avoid_: schedule, rule (the code's name only)

**Subject**:
What attendance is counted by; defaults to the series title, so two series (a lecture and a lab) can share one.

**Occurrence**:
One dated appearance of a series, worked out from its rule whenever it is needed and never stored.
_Avoid_: instance, slot, event

**Override**:
Something said by hand about one occurrence: cancelling it, moving it, or a note on it. It always beats a day off.
_Avoid_: exception, edit

**Note**:
Text written on one occurrence.
_Avoid_: comment, memo, description

**Extra**:
An occurrence added by hand that the series' timing never produced, such as a make-up class.

**Day off**:
A whole day, entered with others as one batch, that cancels occurrences: a holiday or an "I'm away" day.
_Avoid_: day exception (the code's name only), holiday (as the umbrella word; a holiday is one kind)

**Holiday**:
A day off on which classes don't happen; it cancels the occurrences of groups that observe holidays, as not held.
_Avoid_: break, vacation

**I'm away**:
A day off on which the user is absent; it cancels every occurrence that day, in any group or none, as skipped.
_Avoid_: leave, personal day

### Cancelling

**Cancelled**:
The status of an occurrence that did not or will not happen. It is never deleted, only drawn differently.
_Avoid_: deleted, missed

**Not held**:
The cancel reason when the occurrence didn't take place at all (the prof cancelled, a holiday). The user gives it with **Prof**, and it reads "Prof cancelled".

**Skipped**:
The cancel reason when the occurrence took place but the user chose not to go. The user gives it with **Me**, and it reads "I skipped".

**Not today**:
A cancel with no reason, the only cancel a group without attendance offers. If the group tracks attendance later, the occurrence reads "No reason given" and is never guessed to be not held or skipped; the calendar draws it like not held.
_Avoid_: unknown, other

**Restore**:
Taking back a cancel, so the occurrence happens again; restoring one on a day off overrules the day off.
_Avoid_: un-cancel, reschedule

### Changing the timetable

**Move**:
Placing one occurrence on a different day and time. It then shows where it was placed, not where it came from: no other occurrence changes, and later changes to the series never move or hide it.
_Avoid_: reschedule, shift

**Ghost**:
The faded mark a moved occurrence leaves at its original slot.
_Avoid_: placeholder, shadow

**Split**:
Ending a series on a day and continuing it as a new, linked series, so a change applies from that day on and never rewrites past occurrences. The pieces still read as one series.
_Avoid_: edit all, migrate

**Applies from**:
The day a timing change to a series takes effect; occurrences before it keep the old timing, and the series' own first day means the change corrects a mistake everywhere.
_Avoid_: edit scope, this and following

**Clash**:
Two occurrences from different series that overlap in time.
_Avoid_: conflict, overlap

**Semester swap**:
Copying a group's series into a new group whose series all begin on one chosen day, for the next semester.
_Avoid_: migrate, clone, new semester

### Lifecycle

**First day** (of a series):
The day a series' occurrences begin. Only series have one: a group never hides a series' occurrences, and a new series suggests the earliest future first day already in its group, else today.
_Avoid_: start day of a group, active from

**Last day**:
The final day a group or series can produce occurrences; a group's last day ends every series in it.
_Avoid_: end date, until (outside the code)

**Archive**:
Giving a group or series a last day; after it nothing more occurs and it leaves the pickers, but everything up to it stays visible. A group or series is archived once its last day has passed.
_Avoid_: delete, close, stop

**Change group**:
Putting a series in a different group. The whole series goes, past included, and keeps its own first and last day.
_Avoid_: move (that's for one occurrence)

**Delete**:
Erasing a group or series together with everything said about its occurrences, extras and moves included.
_Avoid_: archive, remove

**Timetable**:
The JSON file format used to seed, import and export a set of groups and series.
_Avoid_: using it as a name for a group
