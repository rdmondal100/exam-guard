import { useEffect, useState } from 'react';
import { IDLE_EXAM_FILES, type ExamFilesStatus } from '@examguard/shared';

/** How the download of the teacher's exam files is going, live from student main. */
export function useExamFilesStatus(): ExamFilesStatus {
  const [status, setStatus] = useState<ExamFilesStatus>(IDLE_EXAM_FILES);
  useEffect(() => {
    let current = true;
    void window.examguard.examFilesStatus().then((s) => current && setStatus(s));
    const off = window.examguard.onExamFilesStatus(setStatus);
    return () => {
      current = false;
      off();
    };
  }, []);
  return status;
}
