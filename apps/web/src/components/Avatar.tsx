import { useState } from 'react';

/** "Alice Example" → "AE". Falls back to the email's first letter. */
function initials(name: string, email: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters !== '' ? letters : (email[0]?.toUpperCase() ?? '?');
}

/**
 * The user's picture (Google's, when they have one), or their initials when
 * they don't or it fails to load. Decorative: their name is shown beside it.
 */
export function Avatar({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image: string | null;
}) {
  const [failed, setFailed] = useState(false);

  if (image !== null && !failed) {
    return (
      <img
        src={image}
        alt=""
        // Google's image server sometimes refuses requests that carry a Referer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-14 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
    >
      {initials(name, email)}
    </span>
  );
}
