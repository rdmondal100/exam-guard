import type { BackupResult, CertInfo } from '@examguard/shared';
import type { Db } from '../../db/connectDb.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadOrCreateCert } from '../../utils/tls/cert.js';
import { backupData } from '../results/backup.js';

export interface MaintenanceDeps {
  db: Db;
  exams: ExamRepo;
  /** The app data folder (`backups/`, `certs/`). Without it every call is refused. */
  dataDir?: string;
  now?: () => number;
}

/**
 * Settings' manual backup and the TLS certificate (M43). A new certificate changes the
 * fingerprint students pin, so it is refused while an exam is hosting or running.
 */
export class MaintenanceService {
  private readonly now: () => number;

  constructor(private readonly deps: MaintenanceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async backup(): Promise<BackupResult> {
    return { backup: await backupData(this.deps.db, this.dataDir(), new Date(this.now())) };
  }

  async cert(): Promise<CertInfo> {
    const { fingerprint, fpCode } = await loadOrCreateCert(this.dataDir());
    return { fingerprint, fpCode };
  }

  async regenerateCert(): Promise<CertInfo> {
    const dataDir = this.dataDir();
    const live = this.deps.exams.list().some((e) => e.state === 'hosting' || e.state === 'running');
    if (live) {
      throw new ApiError(
        409,
        'hosting_active',
        'Stop hosting first: students who already joined trust the current certificate',
      );
    }
    const { fingerprint, fpCode } = await loadOrCreateCert(dataDir, true);
    return { fingerprint, fpCode };
  }

  private dataDir(): string {
    if (!this.deps.dataDir) throw new ApiError(503, 'no_data_dir', 'The data folder is not set');
    return this.deps.dataDir;
  }
}
