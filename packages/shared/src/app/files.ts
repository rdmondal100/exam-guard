import { z } from 'zod';
import { FILE_NAME_MAX_CHARS } from '../protocol/file-name.js';

/**
 * Limits of the student's Files panel (architecture §4). The folder is the exam workspace, the
 * same one the terminal and Run use. The panel only checks what it writes: a running program can
 * still fill the disk, because the Job Object has no disk limit.
 */
export const FILE_LIMITS = {
  /** Largest text file the panel opens or saves. */
  textBytes: 2 * 1024 * 1024,
  /** Largest image the panel previews. */
  imageBytes: 10 * 1024 * 1024,
  /** What the student's own files may add up to when the panel creates or saves one. */
  workspaceBytes: 200 * 1024 * 1024,
  nameChars: FILE_NAME_MAX_CHARS,
  pathChars: 400,
  /** Entries listed in one folder. */
  entries: 1000,
} as const;

/** Extensions the panel previews as an image, with their MIME type. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** A path inside the workspace, `/`-separated and relative; `''` is the workspace itself. */
export const FilePathSchema = z.string().max(FILE_LIMITS.pathChars);

export const FileEntrySchema = z.object({
  name: z.string(),
  /** From the workspace root, `/`-separated. */
  path: z.string(),
  kind: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative(),
  modifiedMs: z.number(),
  image: z.boolean(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

/** Renderer → main `files:list`. */
export const FilesListRequestSchema = z.object({
  path: FilePathSchema,
  /** Dotfiles and the folders packages install into. */
  showHidden: z.boolean().default(false),
});
export type FilesListRequest = z.input<typeof FilesListRequestSchema>;

export const FilesListSchema = z.object({
  entries: z.array(FileEntrySchema),
  /** More entries than `FILE_LIMITS.entries`; the rest are left out. */
  truncated: z.boolean(),
  /** Size of the student's own files (packages and hidden folders excluded). */
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
});
export type FilesList = z.infer<typeof FilesListSchema>;

/** Renderer → main `files:write`: saves a text file (creating it if it is new). */
export const FileWriteRequestSchema = z.object({
  path: FilePathSchema.min(1),
  content: z.string().max(FILE_LIMITS.textBytes),
});
export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;

/** Renderer → main `files:create`. */
export const FileCreateRequestSchema = z.object({
  path: FilePathSchema.min(1),
  kind: z.enum(['file', 'dir']),
});
export type FileCreateRequest = z.infer<typeof FileCreateRequestSchema>;

/** Renderer → main `files:rename`. */
export const FileRenameRequestSchema = z.object({
  from: FilePathSchema.min(1),
  to: FilePathSchema.min(1),
});
export type FileRenameRequest = z.infer<typeof FileRenameRequestSchema>;

export const FileReadResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), content: z.string() }),
  z.object({ kind: z.literal('image'), dataUrl: z.string() }),
  /** Binary, too large, or a type the panel does not show. */
  z.object({ kind: z.literal('unsupported'), message: z.string() }),
]);
export type FileReadResult = z.infer<typeof FileReadResultSchema>;

/**
 * What every Files call returns: the value, or a message to show the student. A refusal
 * (Files off, bad name, over a limit) is expected, so it is a result and not a thrown error.
 */
export const filesResultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]);
export type FilesResult<T> = { ok: true; value: T } | { ok: false; message: string };
