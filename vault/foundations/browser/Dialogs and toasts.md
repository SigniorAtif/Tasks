# Dialogs and toasts

> **Builds on:** [[Single-page apps and routing]] · [[Responsive layouts]] · [[Server state and caching]]

Two small pieces of interface that most apps have and few build well. A **dialog** puts a panel in front of the page and asks for one decision. A **toast** is a short message at the screen's edge that goes away by itself. v0.3 needed both: tapping a class opens a sheet (a dialog) for that one occurrence, and every cancel offers **Undo** in a toast.

## A dialog is harder than a box on top

Drawing a box over the page is one `div` with `position: fixed`. Making it behave is the work:

- **Focus.** When it opens, keyboard focus should move into it. Tab should cycle inside it, never land on a button hidden behind it. When it closes, focus should return where it was.
- **The page behind is inert.** Taps and clicks on the calendar behind must do nothing, and screen readers shouldn't read it.
- **Escape closes it.** Keyboard users expect that.
- **It sits on top of everything,** whatever `z-index` some other part of the page uses.

Doing that by hand means a focus-trap library, `aria-modal`, `inert` on the rest of the page, and a careful stacking order. Or the browser does it.

## The `<dialog>` element

HTML has a built-in element for this. Put the content inside `<dialog>` and call one method:

```js
dialog.showModal();   // open as a modal: focus moves in, the page behind goes inert
dialog.close();       // close it; the dialog fires a 'close' event
```

`showModal()` buys every item on the list above:

- The dialog goes into the **top layer**, a layer the browser draws above the whole page, so no `z-index` can cover it.
- Everything outside it becomes inert: no clicks, no focus, hidden from screen readers.
- Focus moves to the first focusable thing inside, and Tab stays inside.
- **Escape** closes it, built in.
- A `::backdrop` pseudo-element covers the page behind. Styling it dims the calendar: in Tailwind, `backdrop:bg-slate-950/40`.

Two things it doesn't do for you:

- **Tap outside to close.** A tap on the dimmed backdrop arrives as a click on the `<dialog>` element itself, because the backdrop belongs to it. Your content covers the rest of the dialog's box, so "the click's target *is* the dialog" means "the tap missed the content". Our sheet listens for exactly that.
- **Opening on render.** In React, the element exists once the component has rendered, so `showModal()` is called from an effect, not during render.

There's also `dialog.show()`, which opens it without the modal parts (no top layer, page still usable). Ours is always modal.

### One dialog, two shapes

On a phone a decision panel feels right sliding up from the bottom, near your thumb: a **bottom sheet**. On a laptop the same panel looks lost stretched across the bottom of a wide screen, so it sits in the middle as a normal dialog. It's the same element and the same content. The difference is CSS, switched by a media query at the same 768 px where the calendar switches from Day view to Week view ([[Responsive layouts]]). The browser's own dialog style centres the box and caps its size, so the phone version undoes that: full width, `margin-top: auto` to push it down, round corners only on top.

## Toasts

A toast says "done" and gets out of the way: "Data Structures · I skipped   Undo". It's the opposite of a confirmation dialog, and it's usually the better choice for something you can take back.

| | Ask first ("Cancel this class?") | Do it, then offer Undo |
|---|---|---|
| A correct tap | Costs two taps | Costs one |
| A mis-tap | Caught before it happens | Fixed with one more tap |
| What you learn | To tap "Yes" without reading | That mistakes are cheap |

Undo only works when taking the action back is safe and exact. Ours is: Undo queues the same change as **Restore**, which puts the occurrence back exactly as it was, note included.

What a good toast needs:

- **It goes away by itself.** Ours after 8 seconds: long enough to reach for Undo, short enough not to cover the calendar. A new toast replaces the old one and starts the 8 seconds again.
- **Screen readers announce it.** The toast sits in a **live region**: an element with `role="status"`, which tells screen readers to read out new text inside it when they get a moment. The region must already be in the page *before* the text appears, or the change isn't noticed. So the empty region is always there, and only its content comes and goes.
- **It doesn't steal focus.** Unlike a dialog, a toast never moves focus. You keep doing what you were doing.

### The timer in React

The toast starts a timer when a message appears. In React that's an effect, with a clean-up that cancels the timer if the message changes first:

```tsx
useEffect(() => {
  if (message === null) return;
  const timer = setTimeout(dismiss, 8_000);
  return () => clearTimeout(timer);
}, [message]);
```

One trap: `dismiss` comes from the parent screen, which makes a new function every time it re-renders. If `dismiss` were in the effect's dependency list, every re-render (say, the clock ticking) would restart the 8 seconds. React's `useEffectEvent` wraps a function so the effect always calls its latest version without depending on it, so only a new *message* restarts the timer.

## A mutation that outlives its screen

In ticket #8 the sheet sent the cancel itself and offered Undo when the server answered. What if you closed the sheet with Escape while the request was still out? The sheet is gone, but the answer still comes back.

TanStack Query ([[Server state and caching]]) gives two places to say "when this succeeds":

- On the **hook**, `useMutation({ onSuccess })`. This belongs to the mutation itself and runs whenever it finishes, whether or not the screen that started it is still there.
- On the **call**, `mutate(variables, { onSuccess })`. This belongs to that screen, and runs only while it's still on the page.

Our first version offered Undo from the call. The review caught it: close the sheet mid-request, and the class got its stripes but no Undo. The offer moved to the hook.

Since ticket #9 the question doesn't come up for our sheet. A change is queued and shows at once, so the screen offers Undo the moment you tap, before any request is sent (`queueChange` in `CalendarScreen`, [[Cancelling one occurrence]]), and Undo queues a Restore like any other change, offline too. What happens when the server answers moved to a third place: the client itself (`setMutationDefaults`), which outlives every screen and even a reload ([[Mutations and offline queues]]). The two kinds of callback still matter for every other write, such as the series form's Save.

## Where you'll meet these

- [[Cancelling one occurrence]]: the sheet, the actions it shows, and the Undo toast.
- [[Calendar grid]]: the blocks you tap to open it.
- [[Offline cancels]]: the toast that says a waiting change was refused, even when it happened while you were on another screen.

## Check yourself

1. Name three things `showModal()` does that a `position: fixed` box doesn't.
2. How does our sheet tell "tapped the backdrop" from "tapped a button inside"?
3. Why does the toast's live region stay in the page even when there's no message?
4. Why is Undo, rather than "Are you sure?", the better fit for cancelling a class?
5. A callback passed to `mutate()` didn't run. What did the user probably do while the request was out?
