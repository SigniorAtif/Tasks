# Responsive layouts

> **Builds on:** [[Single-page apps and routing]]

A **responsive** layout changes shape with the screen's width, instead of being one fixed design shrunk or stretched to fit. Our calendar shows one day on your phone and the whole week on a laptop (B11). How our grid makes the switch: [[Calendar grid]].

## CSS pixels and the viewport tag

Widths in CSS are measured in **CSS pixels**, not the screen's physical dots. A typical Android phone is about 412 CSS pixels wide in portrait, though its screen has around 1080 physical pixels across: the browser uses 2–3 physical pixels per CSS pixel so text stays a readable size.

That only works with this line in `index.html` (ours has it, in `apps/web/index.html`):

*From `apps/web/index.html`:*
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Without it, a phone pretends to be a 980-pixel-wide desktop and shrinks the whole page to fit, so every word is tiny. `width=device-width` is the part that prevents that; `initial-scale=1.0` starts unzoomed. Ours adds `viewport-fit=cover`: the installed app may draw under the camera notch and the gesture bar, and the layout then pads itself clear of them with `env(safe-area-inset-top)` and friends (`apps/web/src/routes/__root.tsx`).

## Media queries

A **media query** is a condition about the device that a block of CSS depends on:

```css
.week { display: none; }            /* phones: no week view */

@media (min-width: 768px) {         /* screens 768 CSS px and wider */
  .week { display: grid; }
  .day  { display: none; }
}
```

Width is the common one, but there are others: `(prefers-color-scheme: dark)` (how the app follows your phone's dark mode), `(prefers-reduced-motion: reduce)`, `(orientation: landscape)`.

## Breakpoints

A **breakpoint** is a width at which the layout changes. Tailwind's defaults are `sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px, `2xl` 1536 px. Ours is one breakpoint, **768 px**: below it the Day view, from it the Week view.

Choose breakpoints where *your* design stops working, not from a list of phone models. Seven readable day columns need roughly 700 px, so 768 is where the week starts to fit.

## Mobile-first

Write the phone's layout as the default, then **add** rules for wider screens with `min-width` queries. Tailwind works this way: a class without a prefix applies everywhere, and `md:grid` means "grid **from** 768 px up", not "only on medium screens". So `class="hidden md:grid"` is hidden on phones and a grid on laptops.

Why phone first: the phone is where this app is used most (the dogfood is on Android), a simple layout is easier to grow than a complex one is to squeeze, and phones don't download desktop rules only to override them.

## matchMedia: asking the same question in JavaScript

CSS can hide and rearrange elements, but it can't change what React *renders*. When the two layouts are different components (one day column vs seven), the code asks the same question with `window.matchMedia`:

```ts
const wide = window.matchMedia('(min-width: 768px)');
wide.matches;                                   // true on a laptop, false on your phone
wide.addEventListener('change', (event) => {
  // fires when the width crosses 768 px: turning a tablet, resizing a laptop window
  setView(event.matches ? 'week' : 'day');
});
```

Rendering only the layout that's needed is less work than rendering both and hiding one, and screen readers don't meet a hidden duplicate.

In our app, that listener is wrapped in a small React hook, and the calendar asks it one question:

*From `apps/web/src/calendar/use-media-query.ts` and `apps/web/src/calendar/CalendarScreen.tsx` (shortened):*
```ts
// apps/web/src/calendar/use-media-query.ts
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

// apps/web/src/calendar/CalendarScreen.tsx
const WEEK_VIEW_QUERY = '(min-width: 768px)';
// …
  const view: CalendarView = useMediaQuery(WEEK_VIEW_QUERY) ? 'week' : 'day';
```

What to notice:
- The same `matchMedia` and `change` event as above. `useSyncExternalStore` is React's hook for a value that lives outside React: it subscribes to the change event and re-renders with the new `.matches`.
- `subscribe` returns a function that removes the listener; React calls it when the screen goes away, so no listener is left behind.
- The calendar never stores the view: it asks on every render, so turning a tablet sideways switches Day to Week at once.

A newer tool, **container queries** (`@container (min-width: …)`), sizes a component by the box it sits in rather than by the window: useful once the calendar sits in a narrow panel on a wide screen. The plan mentions them (09 §5.9); v0.2 doesn't need them.

## Why one day on a phone

Your phone has about 412 px. Take away roughly 48 px for the hour labels and 364 px are left. Seven days would get about 52 px each: "Data Structures" doesn't fit, and a 15-minute block would be a sliver too small to tap reliably (accessibility guidelines ask for targets of at least 24 × 24 px). One day gets all 364 px: full titles and big targets, with arrows or a swipe to change day. On a laptop, seven columns of 100 px or more fit, and seeing the whole week at once is the point.

## Check yourself
- Your phone is 412 px wide. You turn it sideways and it becomes about 915 px wide. Which view should appear, and what in the code notices the change?
- Why does Tailwind's `md:grid` mean "from 768 px up" and not "only between 768 and 1024"?
- Predict: delete the viewport tag from `index.html` and open the app on your phone. What changes, and why?
