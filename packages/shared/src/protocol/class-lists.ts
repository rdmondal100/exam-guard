import { z } from 'zod';

export const MAX_CLASS_LIST_ROWS = 5000;
export const MAX_CLASS_LIST_NAME_LENGTH = 100;
/** Cap on `csvText` characters (about 1 MB). */
export const MAX_CSV_CHARS = 1_000_000;

/** `POST /class-lists/import`. `dryRun` returns the preview and writes nothing. */
export const ClassListImportBodySchema = z.object({
  name: z.string().trim().min(1).max(MAX_CLASS_LIST_NAME_LENGTH),
  csvText: z.string().max(MAX_CSV_CHARS),
  dryRun: z.boolean().optional(),
});
export type ClassListImportBody = z.infer<typeof ClassListImportBodySchema>;

export const ClassStudentRowSchema = z.object({
  studentCode: z.string(),
  name: z.string(),
});
export type ClassStudentRow = z.infer<typeof ClassStudentRowSchema>;

export const CsvRowErrorCodeSchema = z.enum([
  'blank_id',
  'blank_name',
  'duplicate_id',
  'too_few_columns',
]);
export type CsvRowErrorCode = z.infer<typeof CsvRowErrorCodeSchema>;

/** A row that was not imported. `line` is the 1-based line in the CSV text. */
export const CsvRowErrorSchema = z.object({
  line: z.number().int().positive(),
  code: CsvRowErrorCodeSchema,
  message: z.string(),
  raw: z.string(),
});
export type CsvRowError = z.infer<typeof CsvRowErrorSchema>;

export const ClassListSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  studentCount: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export type ClassListSummary = z.infer<typeof ClassListSummarySchema>;

/** `list` is absent for a dry run. `rows` are the valid rows that were (or would be) saved. */
export const ClassListImportResultSchema = z.object({
  list: ClassListSummarySchema.optional(),
  rows: z.array(ClassStudentRowSchema),
  errors: z.array(CsvRowErrorSchema),
});
export type ClassListImportResult = z.infer<typeof ClassListImportResultSchema>;

export const ClassListsSchema = z.array(ClassListSummarySchema);
export const ClassStudentsSchema = z.array(ClassStudentRowSchema);
