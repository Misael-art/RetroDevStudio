import {
  cloneElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

interface FormControlAriaProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
}

export interface FormFieldProps {
  label: ReactNode;
  children: ReactElement<FormControlAriaProps>;
  id?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

function generatedFieldId(reactId: string) {
  const safeSuffix = reactId.replace(/[^a-zA-Z0-9_-]/g, "") || "root";
  return `rds-field-${safeSuffix}`;
}

function mergeIdReferences(...values: Array<string | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => value?.trim().split(/\s+/) ?? [])
        .filter(Boolean)
    )
  ).join(" ") || undefined;
}

export function FormField({
  label,
  children,
  id,
  description,
  error,
  required = false,
  className = "",
}: FormFieldProps) {
  const reactId = useId();
  const controlId = id ?? children.props.id ?? generatedFieldId(reactId);
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = mergeIdReferences(
    children.props["aria-describedby"],
    descriptionId,
    errorId
  );

  const control = cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
    "aria-required": required ? true : children.props["aria-required"],
  });

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={controlId} className="text-xs font-medium">
        {label}
        {required ? (
          <span aria-hidden="true" className="rds-status-error ml-1">
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <div id={descriptionId} className="text-xs opacity-75">
          {description}
        </div>
      ) : null}
      {control}
      {error ? (
        <div id={errorId} className="rds-status-error text-xs" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export const Field = FormField;

export default FormField;
