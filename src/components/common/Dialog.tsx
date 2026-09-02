import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const openDialogs: symbol[] = [];

function generatedId(prefix: string, reactId: string) {
  const safeSuffix = reactId.replace(/[^a-zA-Z0-9_-]/g, "") || "root";
  return `${prefix}-${safeSuffix}`;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[hidden],[inert]")
  );
}

function removeFromDialogStack(dialogToken: symbol) {
  const index = openDialogs.lastIndexOf(dialogToken);
  if (index >= 0) {
    openDialogs.splice(index, 1);
  }
}

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeOnEscape?: boolean;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  portal?: boolean;
  portalContainer?: Element | DocumentFragment | null;
  className?: string;
  overlayClassName?: string;
}

export default function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  closeOnEscape = true,
  closeLabel = "Fechar diálogo",
  initialFocusRef,
  portal = true,
  portalContainer,
  className = "",
  overlayClassName = "",
}: DialogProps) {
  const reactId = useId();
  const titleId = generatedId("rds-dialog-title", reactId);
  const descriptionId = generatedId("rds-dialog-description", reactId);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const currentDialog = dialogRef.current;
    if (!currentDialog) {
      return;
    }
    const dialogElement: HTMLDivElement = currentDialog;

    const dialogToken = Symbol("rds-dialog");
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogBody = dialogElement.querySelector<HTMLElement>("[data-rds-dialog-body]");
    openDialogs.push(dialogToken);

    const focusTarget =
      initialFocusRef?.current ??
      dialogElement.querySelector<HTMLElement>("[data-rds-dialog-initial-focus]") ??
      (dialogBody ? getFocusableElements(dialogBody)[0] : undefined) ??
      getFocusableElements(dialogElement)[0] ??
      dialogElement;
    focusTarget.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialogToken) {
        return;
      }

      if (event.key === "Escape") {
        if (closeOnEscape) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(dialogElement);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (!dialogElement.contains(activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      removeFromDialogStack(dialogToken);
      if (invoker?.isConnected) {
        invoker.focus();
      }
    };
  }, [closeOnEscape, initialFocusRef, open]);

  if (!open) {
    return null;
  }

  const dialog = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 ${overlayClassName}`}
      data-rds-dialog-overlay=""
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`rds-surface-panel rds-border-subtle flex max-h-[calc(100vh-24px)] w-[min(640px,calc(100vw-24px))] flex-col overflow-hidden rounded border shadow-2xl ${className}`}
      >
        <header className="rds-surface-panel-strong rds-border-subtle flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs opacity-75">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
            className="rds-border-subtle flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded border text-base leading-none opacity-75 transition-opacity hover:opacity-100"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div data-rds-dialog-body="" className="min-h-0 flex-1 overflow-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );

  if (portal && typeof document !== "undefined") {
    return createPortal(dialog, portalContainer ?? document.body);
  }

  return dialog;
}
