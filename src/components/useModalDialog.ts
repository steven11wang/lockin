import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface HiddenElementState {
  count: number;
  hadInert: boolean;
  ariaHidden: string | null;
}

const hiddenElementStates = new WeakMap<HTMLElement, HiddenElementState>();

export interface ModalDialogOptions {
  dialogRef: RefObject<HTMLDialogElement | null>;
  layerRef: RefObject<HTMLElement | null>;
  getInitialFocus: (dialog: HTMLDialogElement) => HTMLElement | null;
  onCancel: () => void;
}

function hideOutsideLayer(layer: HTMLElement): HTMLElement[] {
  const changed: HTMLElement[] = [];
  let branch: HTMLElement = layer;

  while (branch.parentElement !== null && branch.parentElement !== document.body) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      const existing = hiddenElementStates.get(sibling);
      if (existing === undefined) {
        hiddenElementStates.set(sibling, {
          count: 1,
          hadInert: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
      } else {
        existing.count += 1;
      }
      changed.push(sibling);
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    branch = branch.parentElement;
  }

  return changed;
}

function restoreOutsideLayer(changed: readonly HTMLElement[]): void {
  for (const element of changed) {
    const state = hiddenElementStates.get(element);
    if (state === undefined) continue;
    state.count -= 1;
    if (state.count > 0) continue;
    if (!state.hadInert) element.removeAttribute('inert');
    if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', state.ariaHidden);
    hiddenElementStates.delete(element);
  }
}

function focusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hasAttribute('disabled') && !element.closest('[inert]'));
}

export function useModalDialog({
  dialogRef,
  layerRef,
  getInitialFocus,
  onCancel,
}: ModalDialogOptions): {
  onDialogCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onDialogKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void;
} {
  const nativeModal = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const layer = layerRef.current;
    if (dialog === null || layer === null) return undefined;

    const invoker = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        nativeModal.current = true;
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
    getInitialFocus(dialog)?.focus();
    const hiddenElements = hideOutsideLayer(layer);

    return () => {
      restoreOutsideLayer(hiddenElements);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (invoker?.isConnected) invoker.focus();
    };
  }, []);

  const onDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onCancel();
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape' && !nativeModal.current) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements(event.currentTarget);
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { onDialogCancel, onDialogKeyDown };
}
