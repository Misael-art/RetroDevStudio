import { forwardRef, type ReactNode } from "react";
import Button, { type ButtonProps } from "./Button";

export interface IconButtonProps
  extends Omit<ButtonProps, "aria-label" | "children" | "iconEnd" | "iconStart"> {
  "aria-label": string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { "aria-label": accessibleLabel, className, icon, title, ...buttonProps },
  ref
) {
  return (
    <Button
      {...buttonProps}
      ref={ref}
      aria-label={accessibleLabel}
      title={title ?? accessibleLabel}
      className={["rds-icon-button", className].filter(Boolean).join(" ")}
    >
      <span className="rds-button__icon" aria-hidden="true">
        {icon}
      </span>
    </Button>
  );
});

export default IconButton;
