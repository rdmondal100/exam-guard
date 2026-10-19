import type { AppInfo } from '@examguard/shared';

/** Placeholder until the real Student screens exist. */
export function ModeHome({ info }: { info: AppInfo }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-8">
      <h1 className="text-3xl font-semibold">Student mode</h1>
      <p className="mt-2 text-muted">
        Profile: {info.profile} · Install type: {info.installType}
      </p>
    </main>
  );
}
