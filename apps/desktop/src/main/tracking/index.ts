import { app, powerMonitor, screen } from 'electron';
import type { MonitorStatus } from '@examguard/shared';
import { toolchainsDir } from '../runner/toolchains.js';
import { captureScreenJpeg } from '../screenshots/capture.js';
import { siteReaderPath } from '../utils/paths.js';
import { ExamMonitor, type MonitorSession } from './examMonitor.js';
import { readForeground, readOpenWindows, toFrontWindow, type FrontWindow } from './foreground.js';
import { createInsideCheck } from './inside.js';
import { checkMonitor } from './monitorCheck.js';
import type { OwnProcesses } from './ownProcesses.js';
import { createSiteResolver, runSiteReader } from './site.js';
import { Tracker } from './tracker.js';

export { wantsMonitoring } from './examMonitor.js';
export { OwnProcesses } from './ownProcesses.js';

export interface MonitoringDeps {
  session: MonitorSession & { setMonitorStatus(status: MonitorStatus): void };
  own: OwnProcesses;
}

const screenCount = () => screen.getAllDisplays().length;

/** Programs with a window, front to back. */
async function listWindows(): Promise<FrontWindow[]> {
  return (await readOpenWindows()).flatMap((raw) => {
    const window = toFrontWindow(raw);
    return window ? [window] : [];
  });
}

/**
 * The student app's monitor, wired to Windows through get-windows, SiteReader and Electron
 * (requirements §8.5). Returns the exam monitor (fed with every exam state) and the self-check
 * the join runs; the latest check, with the current screen count, is what the server hears as
 * `monitor.status`.
 */
export function createMonitoring({ session, own }: MonitoringDeps) {
  const sites = createSiteResolver({
    readAddress: (windowId) => runSiteReader(siteReaderPath(), windowId),
  });
  const isInside = createInsideCheck({
    ownPid: process.pid,
    own,
    // Not the run folder: the student can copy any program into the workspace (M59). A program
    // from it counts only while it is the run's own process (by pid).
    roots: () => [
      toolchainsDir({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      }),
    ],
  });
  let monitor: ExamMonitor | null = null;
  let stalledNow = false;
  const tracker = new Tracker({
    readFront: () => readForeground(),
    resolveSite: (window) => sites.resolve(window),
    listWindows,
    isInside,
    capture: (policy, near) =>
      captureScreenJpeg(policy.maxWidth, {
        quality: policy.jpegQuality,
        ...(near ? { near } : {}),
      }),
    screens: screenCount,
    watchScreens: (onChange) => {
      const changed = () => onChange(screenCount());
      screen.on('display-added', changed);
      screen.on('display-removed', changed);
      return () => {
        screen.off('display-added', changed);
        screen.off('display-removed', changed);
      };
    },
    watchLock: (onLock) => {
      powerMonitor.on('lock-screen', onLock);
      return () => powerMonitor.off('lock-screen', onLock);
    },
    emit: (evidence) => monitor?.evidence(evidence),
    // A stalled monitor shows as "Not monitored" on the teacher's roster until it is back (M63).
    onStall: (stalled) => {
      stalledNow = stalled;
      if (latest) publish(latest);
    },
  });
  monitor = new ExamMonitor(tracker, session);
  app.once('will-quit', () => tracker.stop());

  let latest: MonitorStatus | null = null;
  const publish = (status: MonitorStatus) => {
    latest = status;
    session.setMonitorStatus(stalledNow ? { ...status, ok: false } : status);
  };
  const check = async (): Promise<MonitorStatus> => {
    const status = await checkMonitor({
      capture: () => captureScreenJpeg(160),
      readFront: () => readForeground(),
      screens: screenCount,
    });
    publish(status);
    return status;
  };
  const screensChanged = () => {
    if (latest) publish({ ...latest, monitors: screenCount() });
  };
  screen.on('display-added', screensChanged);
  screen.on('display-removed', screensChanged);

  return { monitor, check };
}
