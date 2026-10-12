import { createFileRoute } from '@tanstack/react-router';

// `/`, the home screen. It will show the signed-in user.
export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return <h1 className="text-2xl font-semibold">Tasks</h1>;
}
