import type { ComponentProps, ReactNode } from "react";

const control =
  "block w-full rounded-xl border-2 border-neutral-300 bg-white px-3 py-2.5 text-base text-neutral-950 placeholder:text-neutral-500 focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600";

type FieldShellProps = {
  label: ReactNode;
  name: string;
  error?: string;
  help?: ReactNode;
  children: ReactNode;
};

function FieldShell({ label, name, error, help, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-semibold text-neutral-800">
        {label}
      </label>
      {children}
      {help && !error && (
        <p id={`${name}-help`} className="text-sm text-neutral-600">
          {help}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(name: string, error?: string, help?: ReactNode) {
  return error ? `${name}-error` : help ? `${name}-help` : undefined;
}

export function TextField({
  label,
  name,
  error,
  help,
  ...props
}: Omit<FieldShellProps, "children"> & ComponentProps<"input">) {
  return (
    <FieldShell label={label} name={name} error={error} help={help}>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, error, help)}
        className={control}
        {...props}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  name,
  error,
  help,
  ...props
}: Omit<FieldShellProps, "children"> & ComponentProps<"textarea">) {
  return (
    <FieldShell label={label} name={name} error={error} help={help}>
      <textarea
        id={name}
        name={name}
        rows={4}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, error, help)}
        className={control}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  error,
  help,
  children,
  ...props
}: Omit<FieldShellProps, "children"> & ComponentProps<"select">) {
  return (
    <FieldShell label={label} name={name} error={error} help={help}>
      <select
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, error, help)}
        className={control}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  name,
  help,
  ...props
}: { label: ReactNode; name: string; help?: ReactNode } & ComponentProps<"input">) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={name}
        name={name}
        type="checkbox"
        className="mt-0.5 size-6 shrink-0 rounded border-2 border-neutral-400 accent-brand-700"
        aria-describedby={help ? `${name}-help` : undefined}
        {...props}
      />
      <div>
        <label htmlFor={name} className="text-base font-medium text-neutral-900">
          {label}
        </label>
        {help && (
          <p id={`${name}-help`} className="text-sm text-neutral-600">
            {help}
          </p>
        )}
      </div>
    </div>
  );
}
