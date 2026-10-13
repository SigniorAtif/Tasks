import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  type CalendarResponse,
  expand,
  type GroupList,
  type ScheduleGroup,
  type SeriesList,
} from '@tasks/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser, scheduleGroup, series } from '../db/schema.ts';
import { alice, calendarTestApp, json, signIn } from '../test/calendar.ts';
import { resetDatabase, testDb } from '../test/database.ts';
import { testDatabaseUrl, testEnv } from '../test/env.ts';
import { describeSeed, SeedError, seedRefusal, seedTimetable } from './seed.ts';

const run = promisify(execFile);
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/seed.ts');
const SAMPLE_PATH = 'fixtures/sample-timetable.json';
const sample: unknown = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../../..', SAMPLE_PATH), 'utf8'),
);

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The test environment, allowing you@example.com, on this machine. */
const env = testEnv({ AUTH_ALLOWED_EMAILS: 'you@example.com,alice@example.com' });

async function insertUser(email: string): Promise<string> {
  const [user] = await testDb.insert(authUser).values({ name: email, email }).returning();
  if (!user) throw new Error('insert returned nothing');
  return user.id;
}

async function count(table: typeof scheduleGroup | typeof series): Promise<number> {
  return (await testDb.select().from(table)).length;
}

describe('seedRefusal', () => {
  it.each([
    'postgres://tasks:tasks@localhost:5432/tasks',
    'postgres://tasks:tasks@127.0.0.1:5432/tasks',
    'postgres://tasks:tasks@[::1]:5432/tasks',
  ])('allows a database on this machine: %s', (url) => {
    expect(
      seedRefusal({ DATABASE_URL: url, BETTER_AUTH_URL: 'http://localhost:5173' }),
    ).toBeUndefined();
  });

  it('refuses a database elsewhere', () => {
    expect(
      seedRefusal({
        DATABASE_URL: 'postgres://tasks:secret@db.example.com:5432/tasks',
        BETTER_AUTH_URL: 'http://localhost:5173',
      }),
    ).toMatch(/db\.example\.com/);
  });

  it('refuses an app that is not local, even with a local database', () => {
    expect(
      seedRefusal({
        DATABASE_URL: 'postgres://tasks:tasks@localhost:5432/tasks',
        BETTER_AUTH_URL: 'https://tasks.example.com',
      }),
    ).toMatch(/BETTER_AUTH_URL/);
  });
});

describe('seedTimetable', () => {
  it('writes the sample for the first allowed email, and says so in counts', async () => {
    await insertUser('you@example.com');
    const result = await seedTimetable({ env, db: testDb }, sample);
    expect(result).toEqual({ email: 'you@example.com', groups: 2, series: 20, replaced: 0 });
    expect(describeSeed(result)).toBe('Seeded 2 groups and 20 series for you@example.com.');
    expect(await count(scheduleGroup)).toBe(2);
    expect(await count(series)).toBe(20);
  });

  it("replaces the user's groups with the same names on a re-run, and nothing else", async () => {
    const you = await insertUser('you@example.com');
    const someone = await insertUser('alice@example.com');
    await testDb.insert(scheduleGroup).values([
      // The same user's group with another name stays.
      { userId: you, name: 'Clubs', activeFrom: '2026-07-01' },
      // Another user's group with a name from the file stays too.
      { userId: someone, name: 'Health', activeFrom: '2026-07-01' },
    ]);
    await seedTimetable({ env, db: testDb }, sample, 'you@example.com');
    const firstIds = (await testDb.select().from(series)).map((row) => row.id);

    const again = await seedTimetable({ env, db: testDb }, sample, ' You@Example.com ');
    expect(again).toMatchObject({ groups: 2, series: 20, replaced: 2 });
    expect(describeSeed(again)).toBe(
      'Seeded 2 groups and 20 series for you@example.com, replacing 2 groups.',
    );

    const yours = await testDb.select().from(scheduleGroup).where(eq(scheduleGroup.userId, you));
    expect(yours.map((group) => group.name).sort()).toEqual([
      'Classes · Sem 3 (sample)',
      'Clubs',
      'Health',
    ]);
    const theirs = await testDb
      .select()
      .from(scheduleGroup)
      .where(eq(scheduleGroup.userId, someone));
    expect(theirs.map((group) => group.name)).toEqual(['Health']);
    const secondIds = (await testDb.select().from(series)).map((row) => row.id);
    expect(secondIds).toHaveLength(20);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('refuses a non-local setup before touching the database', async () => {
    await insertUser('you@example.com');
    const remote = testEnv({
      DATABASE_URL: 'postgres://tasks:tasks@db.example.com:5432/tasks',
      AUTH_ALLOWED_EMAILS: 'you@example.com',
    });
    // `db` is the real test database: a refusal must come before any write to it.
    await expect(seedTimetable({ env: remote, db: testDb }, sample)).rejects.toThrow(
      /seed refuses to run: DATABASE_URL/,
    );
    expect(await count(scheduleGroup)).toBe(0);
  });

  it('asks for a sign-in first when the user does not exist', async () => {
    const failure = seedTimetable({ env, db: testDb }, sample, 'you@example.com');
    await expect(failure).rejects.toThrow(SeedError);
    await expect(failure).rejects.toThrow(
      'sign in once or run `pnpm --filter @tasks/api dev:session you@example.com` first',
    );
  });

  it('lists the problems of an invalid file by path, and writes nothing', async () => {
    await insertUser('you@example.com');
    const withHolidays = { ...(sample as object), holidays: [] };
    const broken = structuredClone(sample) as { groups: { classes: { end: string }[] }[] };
    const line = broken.groups[0]?.classes[2];
    if (line) line.end = '13:00';

    const failure = seedTimetable({ env, db: testDb }, withHolidays);
    await expect(failure).rejects.toThrow(
      [
        'The timetable file has problems:',
        '  - (the whole file): Unrecognized key: "holidays"',
      ].join('\n'),
    );
    await expect(seedTimetable({ env, db: testDb }, broken)).rejects.toThrow(
      '  - groups.0.classes.2.end: must be after start, on the same day',
    );
    expect(await count(scheduleGroup)).toBe(0);
  });
});

describe('the seeded sample in the calendar', () => {
  it("is exactly what expand() makes of alice's seeded rows", async () => {
    const client = await signIn(calendarTestApp(), alice);
    await seedTimetable({ env, db: testDb }, sample, alice.email);

    const { groups } = await json<GroupList>(await client.get('/api/v1/groups'));
    const list = await json<SeriesList>(await client.get('/api/v1/series'));
    const window = { from: '2026-10-12', to: '2026-10-18' };
    const response = await json<CalendarResponse>(
      await client.get(`/api/v1/calendar?from=${window.from}&to=${window.to}`),
    );
    expect(response).toEqual({
      ...window,
      occurrences: expand({
        groups,
        series: list.series,
        overrides: [],
        dayExceptions: [],
        window,
      }),
    });
    // 12 classes (the fortnightly lab is off that week) and a run every day.
    expect(response.occurrences).toHaveLength(12 + 7);
    expect(groups.map((group: ScheduleGroup) => [group.name, group.colorToken])).toEqual([
      ['Health', 'green'],
      ['Classes · Sem 3 (sample)', 'blue'],
    ]);
  });
});

describe('the seed script', () => {
  /** Like a developer's shell: the test database, the app on localhost. */
  const local = {
    PATH: process.env.PATH ?? '',
    DATABASE_URL: testDatabaseUrl(),
    BETTER_AUTH_URL: 'http://localhost:5173',
    AUTH_ALLOWED_EMAILS: 'you@example.com',
  };

  it('seeds the sample file named relative to the repo root, printing counts only', async () => {
    await insertUser('you@example.com');
    const { stdout } = await run(process.execPath, [SCRIPT, SAMPLE_PATH], { env: local });
    expect(stdout.trim()).toBe('Seeded 2 groups and 20 series for you@example.com.');
    expect(stdout).not.toContain('Data Structures');
    expect(await count(series)).toBe(20);
  });

  it('refuses to run against a database that is not on this machine', async () => {
    await insertUser('you@example.com');
    const result = run(process.execPath, [SCRIPT, SAMPLE_PATH], {
      env: { ...local, DATABASE_URL: 'postgres://tasks:tasks@db.example.com:5432/tasks' },
    });
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('seed refuses to run'),
    });
    expect(await count(scheduleGroup)).toBe(0);
  });

  it('exits 1 with a hint when the user has not signed in yet', async () => {
    const result = run(process.execPath, [SCRIPT, SAMPLE_PATH], { env: local });
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('dev:session you@example.com'),
    });
  });

  it('names a missing file without reading anything else', async () => {
    const result = run(process.execPath, [SCRIPT, 'fixtures/no-such-file.json'], { env: local });
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('fixtures/no-such-file.json does not exist'),
    });
  });
});
