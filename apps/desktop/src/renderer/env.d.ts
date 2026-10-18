/// <reference types="vite/client" />
import type { ExamGuardApi } from '../preload/api.js';

declare global {
  interface Window {
    examguard: ExamGuardApi;
  }
}
