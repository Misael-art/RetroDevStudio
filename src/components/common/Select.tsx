import {
  forwardRef,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { ControlSize } from "./Button";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hideLabel?: boolean;
  helperText?: ReactNode;
  errorMessage?: ReactNode;
  controlSize?: ControlSize;
  fieldClassName?: string;
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    "aria-describedby": externalDescription,
    "aria-invalid": ariaInvalid,
    children,
    className,
    controlSize = "md",
    errorMessage,
    fieldClassName,
    helperText,
    hideLabel = false,
    id,
    label,
    required,
    ...selectProps
  },
  ref
) {
  const generatedId = useId();
  const selectId = id ?? `rds-select-${generatedId}`;
  const helperId = helperText ? `${selectId}-helper` : undefined;
  const errorId = errorMessage ? `${selectId}-error` : undefined;
  const describedBy = [externalDescription, helperId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(errorMessage) || ariaInvalid === true || ariaInvalid === "true";

  return (
    <div className={joinClassNames("rds-field", fieldClassName)}>
      {label ? (
        <label
          htmlFor={selectId}
          className={joinClassNames("rds-field__label", hideLabel && "rds-sr-only")}
        >
          {label}
          {required ? (
            <span className="rds-field__required" aria-hidden="true">
              {" *"}
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="rds-field__control-wrap">
        <select
          {...selectProps}
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={joinClassNames(
            "rds-field__control",
            "rds-select",
            `rds-field__control--${controlSize}`,
            className
          )}
        >
          {children}
        </select>
        <span className="rds-select-arrow" aria-hidden="true" />
      </div>
      {helperText ? (
        <p id={helperId} className="rds-field__message">
          {helperText}
        </p>
      ) : null}
      {errorMessage ? (
        <p id={errorId} className="rds-field__message rds-field__message--error">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
});

export default Select;
