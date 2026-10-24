# CSS variables

> **Builds on:** [[Single-page apps and routing]] · [[Responsive layouts]]

A **CSS variable** (officially a *custom property*) is a named value you set once and read anywhere below it on the page. Its name starts with two dashes, and you read it with `var()`:

```css
:root { --brand: #4338ca; }           /* set it on the whole page */
.button { background: var(--brand); } /* read it */
```

Two things make them more than "constants for CSS". They **inherit** down the page, the way a font size does, and they can be **set per element**, even from JavaScript or React's `style`. Our calendar grid uses both, for two different jobs: placing blocks, and switching colours for dark mode. How the grid uses them is in [[Calendar grid]].

## Job 1: geometry from data

Your Thursday OOP class runs 10:00–11:00, so the grid needs a rectangle whose top is "600 minutes down the column". One way is to compute pixels in JavaScript (`top: 600 * 1.2 + 'px'`). We do something else: React only states the *data*, and CSS does the arithmetic.

```html
<button class="tg-block" style="--start: 600; --len: 60; --col: 0; --cols: 1; --span: 1">
```

```css
.tg      { --px-per-min: 1.2; }  /* set once, on the grid */
.tg-block {
  top:    calc(var(--start) * var(--px-per-min) * 1px);  /* 600 × 1.2 × 1px = 720px */
  height: max(22px, calc(var(--len) * var(--px-per-min) * 1px - 2px));
  left:   calc(var(--col) / var(--cols) * 100%);
  width:  calc(var(--span) / var(--cols) * 100% - 3px);
}
```

- `calc()` does arithmetic with units. A plain number times `1px` becomes a length, which is why the formulas end in `* 1px`.
- `max(22px, …)` picks the larger of the two, so a 15-minute block is still 22 px tall: enough to read and tap.
- `--px-per-min` is set **once** on the grid and **inherited** by every block. Zooming (60 px an hour on a phone, 72 on a laptop) changes one variable, and React re-renders no blocks.

Why bother? The numbers the code works with (minutes, columns) stay the numbers in the HTML. You can inspect a block in the browser's dev tools and read `--start: 600`, instead of reverse-engineering `top: 720px`. And the "how big is a minute" decision lives in one place.

The real rules in our grid have one more variable:

*From `apps/web/src/calendar/time-grid.css` (shortened):*
```css
.tg-block {
  --lane: 100%;
  /* … */
  top: calc(var(--start) * var(--px-per-min) * 1px);
  /* At least 22 px, so even a 15-minute block can be read and tapped. */
  height: max(22px, calc(var(--len) * var(--px-per-min) * 1px - 2px));
  left: calc(var(--col) / var(--cols) * var(--lane));
  width: calc(var(--span) / var(--cols) * var(--lane) - 3px);
  /* … */
}

/* … */
.tg-block[data-over-cancelled] {
  --lane: 85%;
}
```

What to notice:
- `--lane` stands where the sketch above had `100%`. CSS itself sets it, per block: a block with the `data-over-cancelled` attribute redefines it as 85%, and the same `left` and `width` formulas squeeze it, leaving the stripes of a cancelled class visible on the right ([[Calendar grid]]).
- `--px-per-min` appears nowhere in this file as a value. React sets it on the grid element (see "In React" below), and every block inherits it.

## Job 2: themes

Our colours are variables with **two values**, one per theme:

```css
:root {
  --grid-surface: oklch(100% 0 0);        /* white */
  --palette-teal: oklch(60% 0.118 184.7);  /* a darker teal for a white page */
}
@media (prefers-color-scheme: dark) {      /* the phone is in dark mode */
  :root {
    --grid-surface: oklch(20.8% 0.042 265.8);   /* near-black */
    --palette-teal: oklch(77.7% 0.152 181.9);   /* a lighter teal for a dark page */
  }
}
```

The blocks only ever say `var(--palette-teal)`. When you switch your phone to dark mode, the media query ([[Responsive layouts]]) swaps the values and every block follows, with no JavaScript. A group stores the **token** `teal`, never a colour code, so retuning the colours later is an edit to one CSS file instead of to everyone's stored data.

## Mixing colours: `color-mix()`

A class block's background is its group colour, faded:

```css
background: color-mix(in oklab, var(--c) 20%, var(--grid-surface));
```

That reads "20% of the group colour, 80% of the surface". On a white page it's a light tint; in dark mode, mixed with the dark surface, it's a dark tint. One line gives the right result in both themes.

`in oklab` names the **colour space** the mixing happens in. `oklch` and `oklab` are colour spaces designed so equal number steps look like equal changes to the eye. (In the older HSL model, yellow and blue at the same "50% lightness" look nothing alike in brightness.) Both describe the same colours: `oklch` uses lightness, chroma (how vivid) and hue (an angle on the colour wheel), while `oklab` uses lightness plus two straight axes. For *mixing*, that difference matters. Mixing in `oklch` also travels around the hue wheel, so orange mixed into our slightly blue dark surface swings through purple on the way. `oklab` mixes in a straight line, so orange fades to a dark orange-brown, as you'd expect.

## Contrast: why the values aren't arbitrary

**Contrast ratio** compares the brightness of two colours, from 1:1 (identical) to 21:1 (black on white). The accessibility guidelines (WCAG) ask for at least **4.5:1** for normal text and **3:1** for shapes that carry meaning, such as a block's coloured edge. Each palette colour was checked: at least 3.5:1 against the grid's surface in its theme, and the text colour at least 12:1 on the 20% tint. That's why light mode uses darker shades of each hue, and dark mode lighter ones.

## In React

React passes `--` names straight to the browser, but TypeScript's type for `style` doesn't list them, so `style={{ '--start': 600 }}` is a type error. Our grid has one small helper, `cssVars()` in `apps/web/src/calendar/css-vars.ts`, that says "these are CSS variables" in one place, instead of a cast on every element.

*From `apps/web/src/calendar/css-vars.ts`, and the two places that use it (shortened):*
```tsx
// apps/web/src/calendar/css-vars.ts
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

// apps/web/src/calendar/TimeGrid.tsx: the zoom, once, on the whole grid
      style={cssVars({ '--px-per-min': pxPerMin, '--days': days.length })}

// apps/web/src/calendar/OccurrenceBlock.tsx: the data, on each block
      style={cssVars({
        '--start': block.startMin,
        '--len': block.endMin - block.startMin,
        // …
      })}
```

What to notice:
- `` `--${string}` `` is a *template literal type*: "any string that starts with `--`" ([[TypeScript essentials]]). So `cssVars({ start: 600 })`, without the dashes, is a type error.
- `as CSSProperties` is the "trust me" cast, written once here instead of on every element.
- Job 1 in practice: the grid sets `--px-per-min` once (1 on a phone, 1.2 on a laptop), and each block only states its minutes and columns.

## Check yourself

- Predict: in dev tools, you change `--px-per-min` on the grid from 1.2 to 2. What happens to every block, the hour lines and the hour labels, and does React re-render anything?
- Why does `calc(var(--start) * var(--px-per-min))` on its own not work as a `top`, and what does `* 1px` fix?
- Break it: change `in oklab` to `in oklch` in `time-grid.css` and look at the orange "Evening run" blocks in dark mode. What do you see, and why?
- A group's colour token is `magenta`, which isn't one of the ten. What colour does its block get, and which file decides?
