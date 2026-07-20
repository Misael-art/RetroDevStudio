import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import type { ControlSize } from "./Button";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  hideLabel?: boolean;
  helperText?: ReactNode;
  errorMessage?: ReactNode;
  controlSize?: ControlSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fieldClassName?: string;
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    "aria-describedby": externalDescription,
    "aria-invalid": ariaInvalid,
    className,
    controlSize = "md",
    errorMessage,
    fieldClassName,
    helperText,
    hideLabel = false,
    id,
    label,
    leadingIcon,
    required,
    trailingIcon,
    ...inputProps
  },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? `rds-input-${generatedId}`;
  const helperId = helperText ? `${inputId}-helper` : undefined;
  const errorId = errorMessage ? `${inputId}-error` : undefined;
  const describedBy = [externalDescription, helperId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(errorMessage) || ariaInvalid === true || ariaInvalid === "true";

  return (
    <div className={joinClassNames("rds-field", fieldClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
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
        {leadingIcon ? (
          <span className="rds-field__leading" aria-hidden="true">
            {leadingIcon}
          </span>
        ) : null}
        <input
          {...inputProps}
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={joinClassNames(
            "rds-field__control",
            `rds-field__control--${controlSize}`,
            Boolean(leadingIcon) && "rds-field__control--with-leading",
            Boolean(trailingIcon) && "rds-field__control--with-trailing",
            className
          )}
        />
        {trailingIcon ? (
          <span className="rds-field__trailing" aria-hidden="true">
            {trailingIcon}
          </span>
        ) : null}
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

export default Input;
