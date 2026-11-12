import { useContext } from 'react';
import { ConfirmContext, type ConfirmFn } from '@/components/common/confirmContext';

/** `const confirm = useConfirm(); if (!(await confirm({ title: '…' }))) return;` (M51). */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>.');
  return confirm;
}
