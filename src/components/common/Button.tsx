import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
  loadingLabel?: string;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled = false,
    iconEnd,
    iconStart,
    loading = false,
    loadingLabel = "Carregando…",
    size = "md",
    type = "button",
    variant = "secondary",
    ...buttonProps
  },
  ref
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={joinClassNames(
        "rds-button",
        `rds-button--${variant}`,
        `rds-button--${size}`,
        className
      )}
    >
      <span
        aria-hidden={loading || undefined}
        className={joinClassNames("rds-button__content", loading && "rds-button__content--loading")}
      >
        {iconStart ? (
          <span className="rds-button__icon" aria-hidden="true">
            {iconStart}
          </span>
        ) : null}
        {children}
        {iconEnd ? (
          <span className="rds-button__icon" aria-hidden="true">
            {iconEnd}
          </span>
        ) : null}
      </span>
      {loading ? (
        <span className="rds-button__loader" role="status">
          <span className="rds-spinner" aria-hidden="true" />
          <span className="rds-sr-only">{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
});

export default Button;
