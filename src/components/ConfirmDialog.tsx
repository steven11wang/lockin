import { useId, useRef, type JSX, type ReactNode } from 'react';
import { useModalDialog } from './useModalDialog';

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  children,
  actions,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const { onDialogCancel, onDialogKeyDown } = useModalDialog({
    dialogRef,
    layerRef,
    getInitialFocus: (dialog) => dialog.querySelector<HTMLButtonElement>('button'),
    onCancel,
  });

  return (
    <div className="confirm-dialog__backdrop" ref={layerRef}>
      <dialog
        className="confirm-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        onCancel={onDialogCancel}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="confirm-dialog__body">{children}</div>
        <div className="confirm-dialog__actions">{actions}</div>
      </dialog>
    </div>
  );
}
