import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

/**
 * The colour scheme in effect (M51). Main applies the Settings choice through `nativeTheme`, so
 * this media query already reflects System / Light / Dark.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark ? 'dark' : 'light';
}

/** The Monaco theme that matches the app. */
export function useMonacoTheme(): 'vs' | 'vs-dark' {
  return useColorScheme() === 'dark' ? 'vs-dark' : 'vs';
}
