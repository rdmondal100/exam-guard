import { z } from 'zod';

/**
 * The app's colour theme (M51), kept per profile in main. `system` follows Windows; main applies it
 * through `nativeTheme.themeSource`, which drives the renderer's `prefers-color-scheme` and the
 * title bar.
 */
export const ThemeSourceSchema = z.enum(['system', 'light', 'dark']);
export type ThemeSource = z.infer<typeof ThemeSourceSchema>;

export const ThemeSetRequestSchema = z.object({ theme: ThemeSourceSchema });
export type ThemeSetRequest = z.infer<typeof ThemeSetRequestSchema>;
