# Calendar grid choices

The calls behind the v0.2 calendar (`apps/web/src/calendar/`). Most come from `docs/brainstorm/00-overview.md` (B10, B11, D-076, D-077) and `09-frontend.md` §5.3–5.7; the ones marked **new** were made while building it and are open to your pushback. How it works: [[Calendar grid]].

## A custom grid, not a calendar library (D-076, B10)

- **Chosen:** our own render-only grid behind the `TimeGridProps` adapter: about 1,100 lines of TypeScript (the screen and its states included) and 290 of CSS, counting the many comments. D-076 guessed 700–850.
- **Alternatives:**
  - **FullCalendar v7** (MIT time grid): mature, but it packs every event into columns. D-077's background layer (a cancelled class drawn full width *behind* whatever replaced it) means fighting its layout engine, and three cancel states mean custom rendering for every event anyway. About 72 KB gzipped.
  - **Schedule-X v4**: modern and small (about 56 KB), but drag and resize, which v1 needs, are paid features.
  - **react-big-calendar**: older, Date-based (not Temporal), and its overlap layout can't be told to leave cancelled events out.
- **Why:** the cancelled-block picture ("the class was cancelled, and look, I used the hour") is the product's core idea, and it lives in the layout algorithm. Owning about 100 lines of [[Interval partitioning]] is cheaper than bending a library. The grid is also a good interview piece: a classic greedy algorithm with a proof.
- **Escape hatch:** if the grid blocks the dogfood for 3+ days, write a FullCalendar component that takes the same `TimeGridProps`. Nothing outside the grid changes. That's why the props stay small.

## Cancelled blocks are a background layer (D-077)

- **Chosen:** cancelled occurrences (not held or skipped) never take a column. They're drawn full width behind; anything overlapping them is drawn at **85%** width so the stripes still show on the right.
- **Alternative:** pack them like any other block. Then a club meeting at 10:30 over a cancelled 10:00 class would get half the width, and the freed hour would *look* busy, the opposite of the point.
- **Cost:** a foreground block can cover the cancelled block's "Skipped" pill (Thursday 22 Oct in the sample week). The pattern and the edge still say "skipped", and the full text is in the label. Fine for v0.2; revisit if it confuses you in the dogfood.

## Day view below 768 px, Week view from 768 px (B11)

- **Chosen:** one breakpoint. Phones get one day with a Mon–Sun strip to jump between days; tablets and laptops get the week. Details: [[Responsive layouts]].
- **Alternatives:** 09 §5.9's three layouts (Day < 640, 3-day 640–1023, Week ≥ 1024). The 3-day view is a third thing to build and test for a size you rarely use; B11 settled on two.
- **new:** the Day view has no day-name row above the grid. The title already says "Tue 13 Oct" and the strip highlights the day, so a third copy would only cost 40 px of a phone screen.

## 12-hour times (B11)

- **Chosen:** `10:00–11:00 AM`, `11:30 AM–12:30 PM`, `9 AM` on the axis. AM/PM is said once when both ends share it.
- **Alternative:** 24-hour, or "whatever the phone's language says" (v0.0's clock did that). B11 picked 12-hour because that's how the timetable and everyone at college say times.
- **How:** `Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })`, split into parts, so the zone is always yours and never the phone's. **new:** day and month *names* come from two small English lists (`Mon`, `Oct`), not `Intl`: they don't depend on any zone, and the exact text is easy to test.

## A fixed palette of 10 tokens (B11, D-077)

- **Chosen:** a group stores a token (`teal`); `src/index.css` gives each token a light and a dark colour; unknown tokens are grey.
- **Alternative:** a free colour picker storing hex codes. Then contrast is whatever the user picked, dark mode needs a computed second colour, and the trap list in 09 §6 calls it out by name.
- **new, the values:** Tailwind's own shades, so the grid matches the rest of the app. Light mode: the 600 shade, or 700 for green, lime and amber, whose 600s only reached about 3.1:1 against white (a pass, but with no margin, and the border also sits next to the tint). Dark mode: the 400 shades. Every edge is at least 3.5:1 against its surface, and text on the 20% tint at least 12:1. The check is a small script, not a test (see "Not tested" below).
- **new, mixing in `oklab`:** tints use `color-mix(in oklab, …)`, not 09's `in oklch`. Mixing in oklch also blends the hue, and orange mixed into the bluish dark surface comes out purple. See [[CSS variables]].

## Fetch the whole week, even in Day view

- **Chosen:** `GET /api/v1/calendar?from=<Mon>&to=<Sun>` whatever the view, and prefetch the week on each side.
- **Alternative:** fetch just the visible day. Smaller answers, but every tap on the day strip is a request (slow on campus Wi-Fi), and the offline cache (D-046, v0.2's other half) would only hold the days you happened to open.
- **Cost:** a week of classes is a few kilobytes. Nothing.
- **new, `staleTime: 60_000`:** without it, a prefetched week is fetched again the moment you page to it, because TanStack Query decides freshness by the settings of the component asking, and the default is "always stale". A minute is short enough that changes on another device still show up soon (and editing a series refetches everything at once anyway).

## ±8 weeks of navigation (v0.2 plan)

- **Chosen:** Previous and Next stop 8 weeks before and after the current week, in whole weeks; the buttons are disabled at the edges.
- **Why:** the plan's "done when" is "this week and 4 weeks ahead"; 8 covers a half-semester either way. The API caps one request at 62 days (B7), and paging week by week never comes near it. A month view or a date picker would be the way to go further, and nobody has asked.

## Scrolling: full 24 hours, opened at `max(now − 1 h, 07:00)` (B11)

- **Chosen:** the grid is always 24 hours tall and scrolls inside itself. On open (and on "Today") it scrolls so an hour before now is at the top, but never earlier than 07:00.
- **Alternative:** show only, say, 07:00–22:00. Simpler, but a 06:00 run or a late lab would silently vanish.
- **new, how "Today" re-scrolls:** it changes the grid's React `key`, so React mounts a fresh grid that runs its first-scroll code again. The alternative, a `scrollToNow()` method exposed through a ref, is more code and one more thing a replacement grid would need.

## The now line ticks once a minute, on the server's clock (09 §5.4)

- **Chosen:** a timer aimed at the start of the next minute, re-synced when the app returns to the front (`visibilitychange`). The time is the server's (`serverNow`), as in v0.0's clock.
- **Alternative:** `setInterval` every second, like v0.0's clock. That redraws the whole grid 60 times a minute to move a line that only moves once.

## The account menu moved behind the avatar (**new**)

- **Chosen:** name, Sign out and the deployed commit open from the avatar in a native HTML **popover**.
- **Alternatives:** a footer line for the commit (costs a row of the phone's screen forever), or a React dropdown with its own outside-click and Escape handling (about 30 lines the browser now does for free).
- **The v0.0 demo still works:** merge a PR, wait for the deploy, tap the avatar, see the new commit.

## Not tested, on purpose

- **Components** have no unit tests: the repo's web tests run in plain Node, and a fake DOM has no layout engine, so a geometry bug would pass anyway (09 §6, trap 8). They were checked in a real browser against a mock API instead. Visual tests in a pinned Playwright image (09 §5.10) can come when the grid starts changing often.
- **The palette's CSS** isn't read by a test: Vitest turns every `.css` import into an empty string unless `vitest.config.ts` opts the file in (`test.css.include`). A one-line change there would let a test check that every token has both colours.

## Check yourself

- FullCalendar would have given drag and drop for free in v1. Which single v0.2 picture made that not worth it, and what's the plan if the custom grid goes badly?
- Why fetch Monday to Sunday when your phone only shows Tuesday? Name the two things that would get worse otherwise.
- Predict: delete the `staleTime` lines from `CalendarScreen.tsx` and page forward three weeks while watching the network tab. How many calendar requests do you see, compared with now?
