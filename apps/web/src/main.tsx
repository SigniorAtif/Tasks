import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { restoreQueryCache } from './lib/persist.ts';
import { registerServiceWorker } from './lib/pwa.ts';
import { queryClient, router } from './router.ts';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html is missing <div id="root">');

registerServiceWorker();

// Put the cache saved on the device back before anything draws. The router's
// first `beforeLoad` asks the cache for the signed-in user; offline, the saved
// copy is the only place it can come from. Waits at most a second, and never
// fails: with no saved copy, the app starts with an empty cache as before.
await restoreQueryCache(queryClient);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
