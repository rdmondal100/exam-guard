import { useEffect, useReducer, useRef } from 'react';

/**
 * A value derived from the clock, re-checked every `ms` (M64). The component re-renders only when
 * the value changes (a boolean such as "time is up" flips once), not on every tick, so a large
 * screen such as the exam with its editors does not repaint four times a second.
 */
export function useTick<T>(compute: (now: number) => T, ms = 250): T {
  const value = compute(Date.now());
  const latest = useRef({ compute, value });
  useEffect(() => {
    latest.current = { compute, value };
  });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(() => {
      const { compute: current, value: shown } = latest.current;
      if (!Object.is(current(Date.now()), shown)) rerender();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return value;
}
