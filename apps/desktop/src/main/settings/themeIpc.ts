import { ipcMain, nativeTheme } from 'electron';
import { ThemeSetRequestSchema, type ThemeSource } from '@examguard/shared';
import { IPC } from '../../shared/ipcChannels.js';
import { loadStoredTheme, saveStoredTheme } from './themeStore.js';

/**
 * The colour theme (M51), in both modes. Applying it through `nativeTheme` switches the renderer's
 * `prefers-color-scheme` and the Windows title bar together, so the page needs no theme state.
 */
export async function applyStoredTheme(userData: string): Promise<void> {
  nativeTheme.themeSource = await loadStoredTheme(userData);
}

export function registerThemeIpc(userData: string): void {
  ipcMain.handle(IPC.themeGet, (): ThemeSource => nativeTheme.themeSource);
  ipcMain.handle(IPC.themeSet, async (_event, payload: unknown): Promise<ThemeSource> => {
    const { theme } = ThemeSetRequestSchema.parse(payload);
    await saveStoredTheme(userData, theme);
    nativeTheme.themeSource = theme;
    return theme;
  });
}
