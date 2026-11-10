# Web Locks and BroadcastChannel

> **Builds on:** [[Origin]] · [[IndexedDB and offline storage]] · [[Transactions]]

Every browser tab open on our site runs its own copy of the app: its own memory, its own TanStack cache, its own timers. What the tabs share is the origin's storage ([[Origin]]): one IndexedDB, where each tab saves its copy under the same key. Two tabs that both save one key, each from its own memory, overwrite each other. This note covers two browser features that let tabs of one site coordinate: a **Web Lock** decides which tab may do something, and a **BroadcastChannel** lets tabs send each other messages. How our app uses them to run in one tab at a time: [[Offline cancels]].

## The problem: two writers, one key

Tab A has been open since the morning. In tab B, offline, you cancel Monday's Data Structures. B's queue holds that change and saves it to IndexedDB. A second later, tab A saves *its* queue, which is empty, under the same key. IndexedDB now holds A's empty queue. Close tab B, and the cancel is gone: nothing on the phone remembers it.

This is a **lost update**: two writers each save a whole value, and the second save erases the first one's change without knowing it existed. Databases fight it with locks inside transactions ([[Transactions]]). Between tabs, the usual fix is to pick one tab to do the job, which is called **leader election**, and the simplest way to pick one is a lock.

## Web Locks

The **Web Locks API** (`navigator.locks`) gives every origin named locks. A lock is just a name, such as `'tasks-app'`. In the default `exclusive` mode, at most one holder at a time has it, across every tab and worker of the origin.

```js
await navigator.locks.request('tasks-app', async (lock) => {
  // Only one tab at a time gets here.
  await doTheWork();
});
// The lock was released when the callback's promise settled.
```

- **You hold it while your callback runs.** The browser calls your callback with the lock, and holds it for you until the promise the callback returns settles. To hold a lock for as long as the tab lives, return a promise that doesn't settle until you decide: `new Promise((release) => { … })`, and call `release()` to let go.
- **The browser frees it when the tab dies.** Closing the tab, a crash, a reload: the lock goes, with no clean-up code. A dead tab can never block the next one. That's the hard part if you build this yourself with a "taken" flag in storage: a tab that crashes never clears its flag.
- **Requests wait in line.** A `request` for a held lock waits, and waiting requests are granted in the order they were made. When the holder lets go, the first one in line gets it.

Three options change the waiting:

| Option | What it does | If another tab holds the lock |
|---|---|---|
| `ifAvailable: true` | Don't wait | Your callback runs at once with `lock` set to `null`, and you hold nothing |
| `signal` | Lets you give up waiting | Aborting it takes you out of the line, and your `request` rejects with an `AbortError` |
| `steal: true` | Take it now | The holder loses it at once and *its* `request` rejects with an `AbortError`. You get the lock, ahead of anyone waiting in line |

`signal` comes from an **`AbortController`**, the browser's standard way to cancel something you started: `const c = new AbortController()`, pass `c.signal` along, and later call `c.abort()`. `fetch` takes the same kind of `signal`, which is how TanStack Query cancels a request nobody needs any more ([[Server state and caching]]).

`steal` is the rough one, meant for recovering from a holder that's stuck. The old holder's callback isn't stopped: its code keeps running, and only its rejected `request` tells it the lock is gone. It must notice that and stop doing the locked work.

Two more details. `navigator.locks.query()` lists who holds and who waits, which helps in the console. And `mode: 'shared'` lets many holders in at once, for jobs that only read. Every major browser has had Web Locks since 2022 (Safari was last, in 15.4), and Node has them too.

## BroadcastChannel

A lock tells a tab "you're not the one", but not how to ask the one to step aside. That takes a message, and a **BroadcastChannel** carries messages between tabs of one origin:

```js
const channel = new BroadcastChannel('tasks-app');
channel.postMessage('take-over');                       // to every other tab on this channel
channel.onmessage = (event) => console.log(event.data); // what the others sent
```

- Every other tab, window or worker of the same origin that opened a channel with that name receives the message. The sender doesn't receive its own.
- The data is copied with structured clone ([[IndexedDB and offline storage]]): strings, numbers, objects and arrays travel, functions don't.
- There's no reply and no receipt. If nobody is listening, the message is simply gone. A sender that needs something to happen has to check later, with a timeout.

## Frozen tabs

To save battery, browsers **freeze** tabs in the background, Chrome on Android most of all. The tab stays open, but its JavaScript stops: no timers fire and no messages are handled. A frozen tab still holds its locks, and a message sent to it waits until it wakes, which might be an hour later. The browser may also **discard** a background tab: throw it out of memory entirely, and load it again when you come back.

So "ask the holder to step aside" can go unanswered. The pattern is to ask, wait a few seconds, and `steal` if nothing happened. When the frozen tab wakes, it finds its `request` rejected, and has to stop.

## Closing a tab from a script

`window.close()` looks like it closes the tab. Browsers only allow it for a tab that a script opened with `window.open()`. For a tab you opened yourself (by typing the address, tapping a link, or tapping the home-screen icon), the call does nothing except print a warning in the console. The rule exists so a page can't close the tab you're using and take your history with it. (The HTML standard also allows closing a tab whose history holds a single page, but browsers differ on that part.) Code that wants a tab out of the way has to plan for `close()` doing nothing.

## In our app

`one-tab.ts` uses one lock and one channel, both named `tasks-app`. The first request asks without waiting:

*From `apps/web/src/lib/one-tab.ts`:*
```ts
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
```

What to notice:
- `ifAvailable: true`: a free lock goes to this tab at once, and the app runs (`run()` returns a promise that holds the lock until a hand-over). A held lock gives `null`, and the tab shows "Tasks is open in another tab" instead of waiting with a blank page.
- The function passed to `showElsewhere` is what the **Use here** button calls. It joins the line *before* posting `take-over`, so when the other tab lets go, this tab is first. `asked` makes a second tap do nothing.
- `handOverMs` is 5 seconds in the app. If this tab still isn't running by then, the other one is probably frozen: `inLine.abort()` leaves the line, so a forgotten request can't win the lock later, and `steal: true` takes it.
- `.catch(taken)` sits on every request. A running tab whose lock is stolen sees its `request` reject, and `taken` makes it step aside.

## Check yourself

1. Why can a tab that crashed never block the next tab from getting the lock? What would you have to build if you used a "taken" flag in IndexedDB instead?
2. A tab calls `request(name, { ifAvailable: true }, cb)` while another tab holds the lock. What does `cb` receive, and does the tab wait?
3. A BroadcastChannel message is sent to a frozen tab. When does that tab act on it? What should the sender do meanwhile?
4. After a `steal`, what happens to the old holder's code, and how does it find out?
5. You open the app from the home-screen icon, and its code calls `window.close()`. What happens? What if the app had opened that tab itself with `window.open()`?
6. Two tabs with no lock both save their queue under one IndexedDB key. Trace how an offline cancel made in one of them gets lost.
