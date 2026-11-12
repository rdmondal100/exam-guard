import { TeacherThumbHeaderSchema, decodeThumbFrame } from '@examguard/shared';

/** The newest grid picture of one student. */
export interface Thumb {
  /** A `blob:` URL of the JPEG; revoked when a newer picture replaces it. */
  url: string;
  /** Server time the picture arrived. */
  ts: number;
}

export interface UrlFactory {
  create(jpeg: Uint8Array): string;
  revoke(url: string): void;
}

const browserUrls: UrlFactory = {
  create: (jpeg) =>
    URL.createObjectURL(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })),
  revoke: (url) => URL.revokeObjectURL(url),
};

/**
 * The latest thumbnail per student (M33), outside React state so a new frame re-renders only its
 * own tile. Tiles subscribe with `subscribe` and read with `get` (useSyncExternalStore).
 */
export class ThumbStore {
  private readonly thumbs = new Map<string, Thumb>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly urls: UrlFactory = browserUrls) {}

  /** Takes one binary teacher frame. Returns `false` for anything that is not a thumbnail. */
  addFrame(data: ArrayBuffer | Uint8Array): boolean {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const frame = decodeThumbFrame(bytes, TeacherThumbHeaderSchema);
    if (!frame) return false;
    const { examStudentId, ts } = frame.header;
    const old = this.thumbs.get(examStudentId);
    if (old && old.ts > ts) return true;
    this.thumbs.set(examStudentId, { url: this.urls.create(frame.jpeg), ts });
    if (old) this.urls.revoke(old.url);
    this.emit();
    return true;
  }

  get = (id: string): Thumb | undefined => this.thumbs.get(id);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Frees every picture (the exam page closed or switched exams). */
  clear(): void {
    for (const thumb of this.thumbs.values()) this.urls.revoke(thumb.url);
    this.thumbs.clear();
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
