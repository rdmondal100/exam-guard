import type {
  AnswerSave,
  AnswerSnapshot,
  RestoredAnswers,
  SnapshotBuffer,
  SnapshotSelected,
} from '@examguard/shared';

const bufferKey = (questionId: string, language: string): string =>
  `${questionId}\u0000${language}`;

/**
 * What the editors should show after a restart: the server's newest version of each buffer, with
 * the saves the server never acked laid over it. For one buffer (or one question's selected
 * language) the higher `clientSeq` wins, since the counter is per student and only goes up.
 */
export function mergeRestore(
  server: AnswerSnapshot | null,
  unacked: readonly AnswerSave[],
): RestoredAnswers {
  const buffers = new Map<string, SnapshotBuffer>();
  for (const b of server?.buffers ?? []) buffers.set(bufferKey(b.questionId, b.language), b);
  const selected = new Map<string, SnapshotSelected>();
  for (const s of server?.selected ?? []) selected.set(s.questionId, s);

  for (const save of unacked) {
    const key = bufferKey(save.questionId, save.language);
    if (save.clientSeq > (buffers.get(key)?.clientSeq ?? 0)) {
      buffers.set(key, {
        questionId: save.questionId,
        language: save.language,
        content: save.content,
        flags: save.flags ?? null,
        clientSeq: save.clientSeq,
      });
    }
    if (save.selected && save.clientSeq > (selected.get(save.questionId)?.clientSeq ?? 0)) {
      selected.set(save.questionId, {
        questionId: save.questionId,
        language: save.language,
        clientSeq: save.clientSeq,
      });
    }
  }

  return {
    buffers: [...buffers.values()].map((b) => ({
      questionId: b.questionId,
      language: b.language,
      content: b.content,
      flags: b.flags ?? '',
    })),
    languages: [...selected.values()].map((s) => ({
      questionId: s.questionId,
      language: s.language,
    })),
  };
}
