import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OtherTabScreen } from './components/OtherTabScreen.tsx';
import { sendQueuedChanges } from './lib/occurrence-queue.ts';
import { runInOneTab } from './lib/one-tab.ts';
import { handOverSavedCopies, restoreQueryCache, stopSavingCopies } from './lib/persist.ts';
import { registerServiceWorker } from './lib/pwa.ts';
import { queryClient, router } from './router.ts';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing <div id="root">');
const root = createRoot(container);

registerServiceWorker();

async function startApp() {
  // Put the cache saved on the device back before anything draws. The router's
  // first `beforeLoad` asks the cache for the signed-in user; offline, the
  // saved copy is the only place it can come from. Waits at most a second, and
  // never fails: with no saved copy, the app starts with an empty cache.
  await restoreQueryCache(queryClient);

  // TanStack Query assumes it's online until the browser fires `offline`,
  // which never happens when the app opens with no signal. It then sends
  // queued changes, which fail and back off, and the `online` event, which
  // isn't news to it, sends nothing: a cancel waited up to 30 s after the
  // signal came back. The browser's `false` is reliable (use-online.ts), so
  // start from it: queued changes then wait, paused, and go the moment the
  // signal returns. Read it now, not when the page loaded: TanStack only hears
  // `online` and `offline` once something listens, and a tab that sat on the
  // "open in another tab" screen had nothing listening.
  onlineManager.setOnline(navigator.onLine);

  // Then send any changes queued before the app was closed, or before the
  // session ran out (signing in again reloads the app, which lands here).
  void sendQueuedChanges(queryClient);

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The app runs in one tab at a time, so the queue of changes saved on the
// device has one writer. A second tab asks first; saying yes there makes this
// one save, let go, and close or start over (one-tab.ts).
runInOneTab({
  start: () => void startApp(),
  showElsewhere: (useHere) =>
    root.render(
      <StrictMode>
        <OtherTabScreen onUseHere={useHere} />
      </StrictMode>,
    ),
  handOver: () => handOverSavedCopies(queryClient),
  leave: () => {
    // Saved already, or the other tab took over without waiting: either way
    // what's saved is the other tab's now.
    stopSavingCopies();
    // Browsers only let a page close a tab that a script opened. Otherwise
    // this tab starts over, and finds the app running in the other one.
    window.close();
    setTimeout(() => location.reload(), 100);
  },
});
