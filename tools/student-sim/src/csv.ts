const HEADER = /^(id|student[ _]?id|student[ _]?code|code)$/i;

/** Student IDs from column 1 of a class-list CSV. Skips a header row, blanks and repeats. */
export function parseStudentCodes(csvText: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  const lines = csvText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const first = (line.split(',')[0] ?? '').trim().replace(/^"|"$/g, '').trim();
    if (!first || (index === 0 && HEADER.test(first)) || seen.has(first)) return;
    seen.add(first);
    codes.push(first);
  });
  return codes;
}

/** The codes 1..count, for a class list made of numbered students. */
export function numberedCodes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(i + 1));
}
