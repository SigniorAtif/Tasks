// One tab at a time.
//
// The queue of occurrence changes made offline is saved on the device under
// one key (persist.ts). Two tabs running at once would each save their own
// copy over the other's, and a cancel made offline in one could vanish when
// the other saved. So only one tab runs the app. A second tab asks first:
// "Use it here?" Saying yes makes the running tab save everything, stop and
// close. Browsers only let a page close a tab that a script opened, so usually
// it starts over instead, showing the asking screen. Then the new tab runs,
// reading what the old one saved.
//
// Two browser features do it:
// - A Web Lock, held for as long as a tab runs the app, says which tab that
//   is. The browser frees it when the tab closes or crashes, so a dead tab
//   never blocks the next one.
// - A BroadcastChannel, a message line between tabs of the same site, carries
//   "take over" from the asking tab to the running one.
//
// A tab the browser has frozen in the background can't answer. After 5 s the
// new tab takes the lock anyway (`steal`), and the old one, once it wakes,
// finds it gone and leaves without saving: what's saved is the new tab's now.

const TAKE_OVER = 'take-over';

/** How long a running tab gets to hand over before the asking tab takes the app. */
const HAND_OVER_MS = 5_000;

/** What `runInOneTab` asks of the app. */
export interface OneTabApp {
  /** Run the app in this tab. */
  start(): void;
  /** Another tab runs it: say so, and call `useHere` to take it over. */
  showElsewhere(useHere: () => void): void;
  /** Another tab is taking over: save everything now. Nothing is released until this ends. */
  handOver(): Promise<void>;
  /** Then get out of the way, saving nothing more: close the tab, or start over. */
  leave(): void;
}

/**
 * Runs the app in this tab if no other tab does, else asks first. `name` names
 * the lock and the channel; `handOverMs` is for tests. Returns a function that
 * stops listening to other tabs (for tests too; a tab never needs it). Without
 * Web Locks or BroadcastChannel (browsers older than 2022), the app just runs.
 */
export function runInOneTab(
  app: OneTabApp,
  name = 'tasks-app',
  handOverMs = HAND_OVER_MS,
): () => void {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined || typeof BroadcastChannel === 'undefined') {
    app.start();
    return () => {};
  }
  const channel = new BroadcastChannel(name);
  let running = false;

  // Holds the lock, and runs the app, until another tab asks for it.
  const run = () =>
    new Promise<void>((release) => {
      running = true;
      channel.onmessage = (event: MessageEvent) => {
        if (event.data !== TAKE_OVER) return;
        channel.onmessage = null;
        void app.handOver().finally(() => {
          release();
          app.leave();
        });
      };
      app.start();
    });

  // The lock was taken while the app ran here: another tab has it now.
  const taken = () => {
    if (!running) return;
    running = false;
    channel.onmessage = null;
    app.leave();
  };

  void locks
    .request(name, { ifAvailable: true }, (lock) => {
      if (lock !== null) return run();
      let asked = false;
      app.showElsewhere(() => {
        if (asked) return;
        asked = true;
        // Join the queue for the lock first, then ask: when the other tab lets
        // go, the lock comes straight here, before a reloading tab can take it.
        const inLine = new AbortController();
        void locks.request(name, { signal: inLine.signal }, run).catch(taken);
        channel.postMessage(TAKE_OVER);
        setTimeout(() => {
          if (running) return;
          inLine.abort();
          void locks.request(name, { steal: true }, run).catch(taken);
        }, handOverMs);
      });
      return undefined;
    })
    .catch(taken);

  return () => channel.close();
}
