// The fixed group colours (B11, D-077). A group stores a token, never a hex value:
// the PWA maps each token to a light and a dark colour, both checked for contrast,
// so a group stays readable in either theme and the colours can be retuned later
// without touching any stored data. Users pick from these ten; there's no free picker.

export const COLOR_TOKENS = [
  'blue',
  'sky',
  'teal',
  'green',
  'lime',
  'amber',
  'orange',
  'red',
  'pink',
  'violet',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** What a new group gets when nobody picks a colour. */
export const DEFAULT_COLOR_TOKEN: ColorToken = 'blue';
