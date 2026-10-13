import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './lib/pwa.ts';
import { queryClient, router } from './router.ts';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html is missing <div id="root">');

registerServiceWorker();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
