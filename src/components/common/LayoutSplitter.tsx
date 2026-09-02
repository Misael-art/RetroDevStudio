/**
 * LayoutSplitter — divisor acessível para react-resizable-panels.
 *
 * O arraste continua sob responsabilidade da biblioteca. Consumidores que
 * controlam o layout podem usar `onResizeIntent` para aplicar passos exatos em
 * pixels e os presets mínimo, máximo e automático.
 */
import { Separator } from "react-resizable-panels";

export type LayoutResizeIntent =
  | { type: "step"; delta: number }
  | { type: "minimum" }
  | { type: "maximum" }
  | { type: "auto" };

export interface LayoutSplitterProps {
  id?: string;
  /** Orientação visual da linha. `horizontal` separa painéis lado a lado. */
  orientation?: "horizontal" | "vertical";
  /** Recebe pedidos de teclado em pixels e pedidos de preset. */
  onResizeIntent?: (intent: LayoutResizeIntent) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function LayoutSplitter({
  id,
  orientation = "horizontal",
  onResizeIntent,
  ariaLabel,
  disabled = false,
}: LayoutSplitterProps) {
  const isHorizontalLine = orientation === "vertical";
  const className = [
    "group relative flex flex-shrink-0 items-center justify-center outline-none",
    "transition-colors duration-150",
    "focus-visible:ring-2 focus-visible:ring-[var(--rds-focus-ring)] focus-visible:ring-inset",
    "hover:bg-[color-mix(in_srgb,var(--rds-action-primary)_12%,transparent)]",
    "data-[separator=pointer]:bg-[color-mix(in_srgb,var(--rds-action-primary)_18%,transparent)]",
    isHorizontalLine ? "h-2 min-h-2 w-full cursor-row-resize" : "h-full w-2 min-w-2 cursor-col-resize",
  ].join(" ");

  const request = (intent: LayoutResizeIntent) => {
    if (!disabled && onResizeIntent) {
      onResizeIntent(intent);
      return true;
    }
    return false;
  };

  return (
    <Separator
      id={id}
      disabled={disabled}
      aria-label={
        ariaLabel ??
        (isHorizontalLine
          ? "Redimensionar painéis acima e abaixo"
          : "Redimensionar painéis à esquerda e à direita")
      }
      title="Arraste para redimensionar. Setas: 8 px; Shift + seta: 32 px; Home/End: limites; Enter ou duplo clique: automático."
      className={className}
      style={
        isHorizontalLine
          ? { flexBasis: 8, minHeight: 8 }
          : { flexBasis: 8, minWidth: 8 }
      }
      onDoubleClick={(event) => {
        if (request({ type: "auto" })) {
          event.preventDefault();
        }
      }}
      onKeyDownCapture={(event) => {
        const step = event.shiftKey ? 32 : 8;
        let intent: LayoutResizeIntent | null = null;

        if (!isHorizontalLine && event.key === "ArrowLeft") {
          intent = { type: "step", delta: -step };
        } else if (!isHorizontalLine && event.key === "ArrowRight") {
          intent = { type: "step", delta: step };
        } else if (isHorizontalLine && event.key === "ArrowUp") {
          intent = { type: "step", delta: -step };
        } else if (isHorizontalLine && event.key === "ArrowDown") {
          intent = { type: "step", delta: step };
        } else if (event.key === "Home") {
          intent = { type: "minimum" };
        } else if (event.key === "End") {
          intent = { type: "maximum" };
        } else if (event.key === "Enter") {
          intent = { type: "auto" };
        }

        if (intent && request(intent)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <span
        aria-hidden="true"
        className={[
          "block rounded-full bg-[var(--rds-border-subtle)] transition-colors",
          "group-hover:bg-[var(--rds-action-primary)]",
          isHorizontalLine ? "h-px w-10" : "h-10 w-px",
        ].join(" ")}
      />
    </Separator>
  );
}
