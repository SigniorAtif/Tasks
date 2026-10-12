import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html is missing <div id="root">');

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>
    </main>
  </StrictMode>,
);
