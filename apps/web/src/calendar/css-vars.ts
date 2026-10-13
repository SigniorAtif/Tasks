import type { CSSProperties } from 'react';

/**
 * A `style` that sets CSS variables: `cssVars({ '--start': 600 })`. React
 * passes `--` names straight to the browser, but its `CSSProperties` type
 * doesn't list them, so this is the one place that says "trust me".
 */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}
