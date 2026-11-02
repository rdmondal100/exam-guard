/**
 * The teacher's Gemini key for a grading run (M38). Until Settings stores it encrypted (M43), it
 * comes only from `EG_GEMINI_API_KEY` in the shell that started the app, never from a file in
 * the repo. It is handed to the server process in memory and never logged.
 */
export function gradingKey(): string | null {
  const key = process.env.EG_GEMINI_API_KEY?.trim();
  return key ? key : null;
}

/** Dev switch: grade with the server's built-in fake instead of Gemini (`EG_FAKE_GRADER=1`). */
export function fakeGraderEnabled(): boolean {
  return process.env.EG_FAKE_GRADER === '1';
}
