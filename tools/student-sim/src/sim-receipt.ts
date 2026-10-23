import { createHash } from 'node:crypto';
import {
  buildReceiptAnswers,
  canonicalAnswers,
  type FinalAnswerInput,
  type Receipt,
} from '@examguard/shared';

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * What is wrong with a receipt, or `null` if it holds up. The hash must follow from the answers it
 * lists; when the student knows what it wrote (it submitted by itself, with every save in), the
 * answers must also be exactly those.
 */
export function receiptProblem(
  receipt: Receipt,
  expected: readonly FinalAnswerInput[] | null,
): string | null {
  if (sha256Hex(canonicalAnswers(receipt.answers)) !== receipt.hash) {
    return 'the hash does not follow from the answers in the receipt';
  }
  if (expected && buildReceiptAnswers(expected, sha256Hex).hash !== receipt.hash) {
    return 'the receipt differs from what the student wrote';
  }
  return null;
}
