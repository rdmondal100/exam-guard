import {
  ANSWER_TEXT_KEY,
  type AnswerSaveRequest,
  type SaveReason,
  type StudentQuestion,
} from '@examguard/shared';
import type { AnswerState } from './answerStore';
import { pickLanguage } from './languages';

/** Everything the scheduler needs to know about the exam screen at one moment. */
export interface AutosaveSnapshot {
  questions: readonly Pick<StudentQuestion, 'id' | 'type' | 'allowedLanguages'>[];
  answers: AnswerState['answers'];
  flags: AnswerState['flags'];
  languages: AnswerState['languages'];
}

/** The autosave period (docs/architecture.md §6). */
export const AUTOSAVE_MS = 10_000;

interface Sent {
  content: string;
  flags: string;
}

/**
 * Decides what to send. It remembers what the server was last given for each buffer
 * `(question, language)`, so a tick sends only the buffers that changed, and a language switch
 * sends the new language's buffer (even an empty one) so the server knows which one is selected.
 */
export class Autosaver {
  private readonly last = new Map<string, Sent>();
  /** The language each question was last saved as the selected one. */
  private readonly selected = new Map<string, string>();

  /** The saves due now. They count as sent: call `forget` for one whose delivery failed. */
  collect(snapshot: AutosaveSnapshot, reason: SaveReason): AnswerSaveRequest[] {
    const out: AnswerSaveRequest[] = [];
    for (const q of snapshot.questions) {
      const plain = q.type === 'written' || q.allowedLanguages.length === 0;
      const chosen = snapshot.languages[q.id];
      const selectedKey = plain ? ANSWER_TEXT_KEY : pickLanguage(q.allowedLanguages, chosen);
      if (!selectedKey) continue;
      const keys: string[] = plain ? [ANSWER_TEXT_KEY] : [...q.allowedLanguages];
      for (const key of keys) {
        const content = snapshot.answers[q.id]?.[key] ?? '';
        const flags = plain ? '' : (snapshot.flags[q.id]?.[key] ?? '');
        const isSelected = key === selectedKey;
        const sent = this.last.get(bufferKey(q.id, key));
        const touched = content !== '' || flags !== '';
        const changed = sent
          ? content !== sent.content || flags !== sent.flags
          : touched || (isSelected && chosen !== undefined);
        const newlySelected =
          isSelected &&
          this.selected.get(q.id) !== key &&
          (touched || sent !== undefined || chosen !== undefined);
        if (!changed && !newlySelected) continue;
        this.last.set(bufferKey(q.id, key), { content, flags });
        if (isSelected) this.selected.set(q.id, key);
        out.push({
          questionId: q.id,
          language: key,
          content,
          selected: isSelected,
          reason,
          ...(plain ? {} : { flags }),
        });
      }
    }
    return out;
  }

  /** A save was not delivered: send that buffer again at the next chance. */
  forget(save: Pick<AnswerSaveRequest, 'questionId' | 'language'>): void {
    this.last.delete(bufferKey(save.questionId, save.language));
    this.selected.delete(save.questionId);
  }
}

const bufferKey = (questionId: string, language: string): string =>
  `${questionId}\u0000${language}`;
