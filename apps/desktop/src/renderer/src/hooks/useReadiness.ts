import { useEffect, useState } from 'react';
import type { ReadinessReport } from '@examguard/shared';

/** The lobby readiness check's latest result (M54); `null` while it has not finished. */
export function useReadiness(): ReadinessReport | null {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  useEffect(() => {
    let current = true;
    const off = window.examguard.onReadiness(setReport);
    void window.examguard.readinessReport().then((r) => {
      if (current && r) setReport(r);
    });
    return () => {
      current = false;
      off();
    };
  }, []);
  return report;
}
