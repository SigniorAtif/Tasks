import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInOneTab } from './one-tab.ts';

/** Everything the tabs of one test did, in order: `A start`, `B elsewhere`… */
let events: string[] = [];
const stops: Array<() => void> = [];
let lockName = 0;

/**
 * Opens a pretend tab named `label`. Web Locks and BroadcastChannel are real
 * (Node has both), shared by every tab in the test under one lock name.
 */
function openTab(label: string, name: string, { frozen = false } = {}) {
  let useHere: (() => void) | undefined;
  stops.push(
    runInOneTab(
      {
        start: () => events.push(`${label} start`),
        showElsewhere: (take) => {
          events.push(`${label} elsewhere`);
          useHere = take;
        },
        // A tab the browser froze in the background never finishes.
        handOver: frozen
          ? () => new Promise(() => {})
          : async () => {
              events.push(`${label} hand over`);
            },
        leave: () => events.push(`${label} leave`),
      },
      name,
      HAND_OVER_MS,
    ),
  );
  return { useHere: () => useHere?.() };
}

/** How long the tests give a tab to hand over. */
const HAND_OVER_MS = 100;

/** A lock and channel name of its own for each test, so tests never meet. */
const freshName = () => `tasks-test-${++lockName}`;

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  events = [];
});

describe('runInOneTab', () => {
  it('runs the app in the first tab, and has a second one ask first', async () => {
    const name = freshName();
    openTab('A', name);
    await vi.waitFor(() => expect(events).toEqual(['A start']));
    openTab('B', name);
    await vi.waitFor(() => expect(events).toEqual(['A start', 'B elsewhere']));
  });

  it('hands over on "Use here": the old tab saves and leaves, then the new one starts', async () => {
    const name = freshName();
    openTab('A', name);
    await vi.waitFor(() => expect(events).toContain('A start'));
    const b = openTab('B', name);
    await vi.waitFor(() => expect(events).toContain('B elsewhere'));

    b.useHere();
    await vi.waitFor(() => expect(events).toContain('B start'));
    expect(events).toEqual(['A start', 'B elsewhere', 'A hand over', 'A leave', 'B start']);
  });

  it('starts the app once, however often "Use here" is tapped', async () => {
    const name = freshName();
    openTab('A', name);
    await vi.waitFor(() => expect(events).toContain('A start'));
    const b = openTab('B', name);
    await vi.waitFor(() => expect(events).toContain('B elsewhere'));

    b.useHere();
    b.useHere();
    await vi.waitFor(() => expect(events).toContain('B start'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.filter((e) => e === 'B start')).toHaveLength(1);
    expect(events.filter((e) => e === 'A hand over')).toHaveLength(1);
  });

  it('takes the app from a tab that never hands over, which then leaves', async () => {
    const name = freshName();
    openTab('A', name, { frozen: true });
    await vi.waitFor(() => expect(events).toContain('A start'));
    const b = openTab('B', name);
    await vi.waitFor(() => expect(events).toContain('B elsewhere'));

    b.useHere();
    await new Promise((resolve) => setTimeout(resolve, HAND_OVER_MS / 2));
    expect(events).not.toContain('B start');
    await vi.waitFor(() => expect(events).toContain('B start'));
    await vi.waitFor(() => expect(events).toContain('A leave'));
    // Once only, though B asked for the lock twice: in line, then by force.
    await new Promise((resolve) => setTimeout(resolve, HAND_OVER_MS));
    expect(events.filter((e) => e === 'B start')).toHaveLength(1);
  });

  it('lets the tab that left take the app back', async () => {
    const name = freshName();
    openTab('A', name);
    await vi.waitFor(() => expect(events).toContain('A start'));
    const b = openTab('B', name);
    await vi.waitFor(() => expect(events).toContain('B elsewhere'));
    b.useHere();
    await vi.waitFor(() => expect(events).toContain('B start'));

    // A has left: in a browser it reloaded, which opens it afresh.
    const again = openTab('A2', name);
    await vi.waitFor(() => expect(events).toContain('A2 elsewhere'));
    again.useHere();
    await vi.waitFor(() => expect(events).toContain('A2 start'));
    expect(events.slice(-3)).toEqual(['B hand over', 'B leave', 'A2 start']);
  });
});
