import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Button from "./Button";
import Icon from "./Icon";
import IconButton from "./IconButton";

export type AdaptivePanelTone = "info" | "warning" | "danger" | "build-blocker";

export interface AdaptivePanelPoint {
  x: number;
  y: number;
}

export interface AdaptivePanelSize {
  width: number;
  height: number;
}

export interface AdaptivePanelState {
  pinned: boolean;
  autoHide: boolean;
  floating: boolean;
  collapsed: boolean;
  position: AdaptivePanelPoint;
  size: AdaptivePanelSize;
}

export interface AdaptivePanelProps {
  panelId?: string;
  title: string;
  children: ReactNode;
  tone?: AdaptivePanelTone;
  className?: string;
  headerActions?: ReactNode;
  defaultPinned?: boolean;
  defaultAutoHide?: boolean;
  defaultFloating?: boolean;
  defaultPosition?: AdaptivePanelPoint;
  defaultSize?: AdaptivePanelSize;
  minSize?: AdaptivePanelSize;
  maxSize?: Partial<AdaptivePanelSize>;
  boundsRef?: RefObject<HTMLElement | null>;
  movable?: boolean;
  resizable?: boolean;
  onStateChange?: (state: AdaptivePanelState) => void;
}

interface PanelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

type PointerInteraction =
  | {
      kind: "move";
      startX: number;
      startY: number;
      position: AdaptivePanelPoint;
    }
  | {
      kind: "resize";
      startX: number;
      startY: number;
      size: AdaptivePanelSize;
    };

const DEFAULT_POSITION: AdaptivePanelPoint = { x: 24, y: 72 };
const DEFAULT_SIZE: AdaptivePanelSize = { width: 360, height: 280 };
const DEFAULT_MIN_SIZE: AdaptivePanelSize = { width: 260, height: 160 };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function isCriticalTone(tone: AdaptivePanelTone) {
  return tone === "warning" || tone === "danger" || tone === "build-blocker";
}

/**
 * Painel reutilizável que pode permanecer dockado ou virar uma janela utilitária.
 * Auto-ocultação é deliberadamente restrita a conteúdo informativo.
 */
export default function AdaptivePanel({
  panelId,
  title,
  children,
  tone = "info",
  className = "",
  headerActions,
  defaultPinned = false,
  defaultAutoHide = false,
  defaultFloating = false,
  defaultPosition = DEFAULT_POSITION,
  defaultSize = DEFAULT_SIZE,
  minSize = DEFAULT_MIN_SIZE,
  maxSize,
  boundsRef,
  movable = true,
  resizable = true,
  onStateChange,
}: AdaptivePanelProps) {
  const generatedId = useId();
  const id = panelId ?? `adaptive-panel-${generatedId.replace(/:/g, "")}`;
  const descriptionId = `${id}-keyboard-help`;
  const critical = isCriticalTone(tone);
  const [pinned, setPinned] = useState(defaultPinned);
  const [autoHide, setAutoHide] = useState(!critical && defaultAutoHide && !defaultPinned);
  const [floating, setFloating] = useState(defaultFloating);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState<AdaptivePanelPoint>(defaultPosition);
  const [size, setSize] = useState<AdaptivePanelSize>(defaultSize);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasFloatingRef = useRef(false);

  const getBounds = useCallback((): PanelBounds => {
    const element = boundsRef?.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    return {
      left: 0,
      top: 0,
      width: Math.max(minSize.width, globalThis.innerWidth || defaultSize.width),
      height: Math.max(minSize.height, globalThis.innerHeight || defaultSize.height),
    };
  }, [boundsRef, defaultSize.height, defaultSize.width, minSize.height, minSize.width]);

  const clampSize = useCallback(
    (next: AdaptivePanelSize, bounds = getBounds()): AdaptivePanelSize => {
      const maximumWidth = Math.min(maxSize?.width ?? bounds.width, bounds.width);
      const maximumHeight = Math.min(maxSize?.height ?? bounds.height, bounds.height);
      return {
        width: clamp(next.width, Math.min(minSize.width, maximumWidth), maximumWidth),
        height: clamp(next.height, Math.min(minSize.height, maximumHeight), maximumHeight),
      };
    },
    [getBounds, maxSize?.height, maxSize?.width, minSize.height, minSize.width]
  );

  const clampPosition = useCallback(
    (
      next: AdaptivePanelPoint,
      nextSize = size,
      bounds = getBounds()
    ): AdaptivePanelPoint => ({
      x: clamp(next.x, bounds.left, bounds.left + bounds.width - nextSize.width),
      y: clamp(next.y, bounds.top, bounds.top + bounds.height - nextSize.height),
    }),
    [getBounds, size]
  );

  const applyGeometry = useCallback(
    (nextPosition: AdaptivePanelPoint, nextSize: AdaptivePanelSize) => {
      const bounds = getBounds();
      const safeSize = clampSize(nextSize, bounds);
      setSize(safeSize);
      setPosition(clampPosition(nextPosition, safeSize, bounds));
    },
    [clampPosition, clampSize, getBounds]
  );

  const fitAutomatically = useCallback(() => {
    const bounds = getBounds();
    const safeSize = clampSize(defaultSize, bounds);
    applyGeometry(
      {
        x: bounds.left + (bounds.width - safeSize.width) / 2,
        y: bounds.top + (bounds.height - safeSize.height) / 2,
      },
      safeSize
    );
    setCollapsed(false);
  }, [applyGeometry, clampSize, defaultSize, getBounds]);

  useEffect(() => {
    if (critical) {
      setAutoHide(false);
      setCollapsed(false);
    }
  }, [critical]);

  useEffect(() => {
    onStateChange?.({ pinned, autoHide, floating, collapsed, position, size });
  }, [autoHide, collapsed, floating, onStateChange, pinned, position, size]);

  useEffect(() => {
    if (!floating) {
      wasFloatingRef.current = false;
      return;
    }

    if (!wasFloatingRef.current) {
      applyGeometry(position, size);
      wasFloatingRef.current = true;
    }

    const recover = () => applyGeometry(position, size);
    window.addEventListener("resize", recover);
    return () => window.removeEventListener("resize", recover);
  }, [applyGeometry, floating, position, size]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      if (interaction.kind === "move") {
        setPosition(
          clampPosition({
            x: interaction.position.x + event.clientX - interaction.startX,
            y: interaction.position.y + event.clientY - interaction.startY,
          })
        );
        return;
      }

      const nextSize = clampSize({
        width: interaction.size.width + event.clientX - interaction.startX,
        height: interaction.size.height + event.clientY - interaction.startY,
      });
      setSize(nextSize);
      setPosition((current) => clampPosition(current, nextSize));
    };

    const endPointerInteraction = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endPointerInteraction);
    window.addEventListener("pointercancel", endPointerInteraction);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endPointerInteraction);
      window.removeEventListener("pointercancel", endPointerInteraction);
    };
  }, [clampPosition, clampSize]);

  const beginMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!floating || !movable || event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    event.preventDefault();
    interactionRef.current = {
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      position,
    };
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!floating || !resizable || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      kind: "resize",
      startX: event.clientX,
      startY: event.clientY,
      size,
    };
  };

  const moveByKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!floating || !movable) {
      return;
    }
    const step = event.shiftKey ? 32 : 8;
    let next: AdaptivePanelPoint | null = null;
    const bounds = getBounds();

    if (event.key === "ArrowLeft") next = { ...position, x: position.x - step };
    if (event.key === "ArrowRight") next = { ...position, x: position.x + step };
    if (event.key === "ArrowUp") next = { ...position, y: position.y - step };
    if (event.key === "ArrowDown") next = { ...position, y: position.y + step };
    if (event.key === "Home") next = { x: bounds.left, y: bounds.top };
    if (event.key === "End") {
      next = {
        x: bounds.left + bounds.width - size.width,
        y: bounds.top + bounds.height - size.height,
      };
    }
    if (event.key === "Enter") {
      fitAutomatically();
      event.preventDefault();
      return;
    }
    if (next) {
      setPosition(clampPosition(next));
      event.preventDefault();
    }
  };

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!floating || !resizable) {
      return;
    }
    const step = event.shiftKey ? 32 : 8;
    let next: AdaptivePanelSize | null = null;
    const bounds = getBounds();

    if (event.key === "ArrowLeft") next = { ...size, width: size.width - step };
    if (event.key === "ArrowRight") next = { ...size, width: size.width + step };
    if (event.key === "ArrowUp") next = { ...size, height: size.height - step };
    if (event.key === "ArrowDown") next = { ...size, height: size.height + step };
    if (event.key === "Home") next = minSize;
    if (event.key === "End") {
      next = {
        width: maxSize?.width ?? bounds.width,
        height: maxSize?.height ?? bounds.height,
      };
    }
    if (event.key === "Enter") {
      fitAutomatically();
      event.preventDefault();
      return;
    }
    if (next) {
      const safeSize = clampSize(next, bounds);
      setSize(safeSize);
      setPosition((current) => clampPosition(current, safeSize, bounds));
      event.preventDefault();
    }
  };

  const togglePinned = () => {
    setPinned((current) => {
      const next = !current;
      if (next) {
        setAutoHide(false);
        setCollapsed(false);
      }
      return next;
    });
  };

  const toggleAutoHide = () => {
    if (critical) {
      return;
    }
    setAutoHide((current) => {
      const next = !current;
      if (next) {
        setPinned(false);
      } else {
        setCollapsed(false);
      }
      return next;
    });
  };

  const toggleFloating = () => {
    setFloating((current) => {
      const next = !current;
      if (next) {
        queueMicrotask(fitAutomatically);
      } else {
        setCollapsed(false);
      }
      return next;
    });
  };

  const toneClass =
    tone === "info"
      ? "border-[var(--rds-border-subtle)]"
      : tone === "warning"
        ? "border-[var(--rds-status-warning)]"
        : "border-[var(--rds-status-error)]";
  if (collapsed && autoHide && !critical) {
    return (
      <Button
        data-testid={`${id}-restore`}
        className={floating ? "fixed z-40" : "w-full"}
        style={floating ? { left: position.x, top: position.y } : undefined}
        onClick={() => setCollapsed(false)}
        onFocus={() => setCollapsed(false)}
        onPointerEnter={() => setCollapsed(false)}
        aria-label={`Mostrar painel ${title}`}
        iconStart={<Icon name="sidebar-expand" size={16} />}
        size="sm"
        variant="secondary"
      >
        Mostrar {title}
      </Button>
    );
  }

  return (
    <section
      ref={panelRef}
      data-testid={id}
      data-tone={tone}
      data-floating={floating || undefined}
      data-auto-hide={autoHide || undefined}
      role="region"
      aria-label={title}
      aria-live={tone === "danger" || tone === "build-blocker" ? "assertive" : "polite"}
      className={[
        "flex min-h-0 flex-col overflow-hidden rounded-lg border",
        "bg-[var(--rds-surface-panel)] text-[var(--rds-text-primary)] shadow-xl",
        toneClass,
        floating ? "fixed z-40" : "relative w-full",
        className,
      ].join(" ")}
      style={
        floating
          ? {
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height,
            }
          : undefined
      }
      onBlurCapture={(event) => {
        if (autoHide && !critical && !event.currentTarget.contains(event.relatedTarget)) {
          setCollapsed(true);
        }
      }}
      onPointerLeave={() => {
        if (autoHide && !critical && !panelRef.current?.contains(document.activeElement)) {
          setCollapsed(true);
        }
      }}
    >
      <div
        data-testid={`${id}-move-handle`}
        className={[
          "flex min-h-9 shrink-0 items-center gap-2 border-b border-[var(--rds-border-subtle)]",
          "bg-[var(--rds-surface-panel-strong)] px-2",
          floating && movable ? "cursor-move" : "",
        ].join(" ")}
        tabIndex={floating && movable ? 0 : undefined}
        aria-label={floating && movable ? `Mover janela ${title}` : undefined}
        aria-describedby={floating && movable ? descriptionId : undefined}
        onPointerDown={beginMove}
        onKeyDown={moveByKeyboard}
        onDoubleClick={(event) => {
          if (floating && movable && !(event.target as HTMLElement).closest("button")) {
            fitAutomatically();
          }
        }}
      >
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</h2>
        {headerActions}
        <IconButton
          data-testid={`${id}-pin`}
          aria-pressed={pinned}
          aria-label={pinned ? `Desafixar painel ${title}` : `Fixar painel ${title}`}
          icon={<Icon name={pinned ? "pin-slash" : "pin"} size={16} />}
          onClick={togglePinned}
          title={pinned ? "Desafixar painel" : "Fixar painel"}
          size="sm"
          variant="ghost"
        />
        <IconButton
          data-testid={`${id}-auto-hide`}
          aria-pressed={autoHide}
          aria-label={
            critical
              ? `Auto-ocultação indisponível para ${title}`
              : autoHide
                ? `Desativar auto-ocultação de ${title}`
                : `Auto-ocultar painel ${title}`
          }
          aria-disabled={critical}
          disabled={critical}
          icon={<Icon name={autoHide ? "sidebar-expand" : "sidebar-collapse"} size={16} />}
          onClick={toggleAutoHide}
          size="sm"
          title={
            critical
              ? "Alertas e bloqueios críticos permanecem visíveis"
              : autoHide
                ? "Desativar auto-ocultação"
                : "Auto-ocultar quando o painel perder o foco"
          }
          variant="ghost"
        />
        <IconButton
          data-testid={`${id}-float`}
          aria-pressed={floating}
          aria-label={floating ? `Acoplar painel ${title}` : `Flutuar painel ${title}`}
          icon={<Icon name={floating ? "sidebar-collapse" : "open-new-window"} size={16} />}
          onClick={toggleFloating}
          size="sm"
          title={floating ? "Acoplar painel" : "Flutuar painel"}
          variant="ghost"
        />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">{children}</div>

      {floating && resizable ? (
        <IconButton
          data-testid={`${id}-resize-handle`}
          className="absolute bottom-1 right-1 cursor-nwse-resize"
          aria-label={`Redimensionar janela ${title}`}
          aria-describedby={descriptionId}
          icon={<Icon name="drag" size={16} />}
          onPointerDown={beginResize}
          onKeyDown={resizeByKeyboard}
          onDoubleClick={fitAutomatically}
          size="sm"
          title="Arraste ou use as setas para redimensionar; Enter restaura o tamanho automático"
          variant="secondary"
        />
      ) : null}

      <p id={descriptionId} className="sr-only">
        Use as setas para ajustar em 8 pixels ou Shift mais seta para 32 pixels. Home e End
        usam os limites. Enter restaura o ajuste automático.
      </p>
    </section>
  );
}
