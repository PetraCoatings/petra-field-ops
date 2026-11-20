import type { ReactNode } from "react";

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-bold text-neutral-950">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item, i) => (
        <div key={i}>
          <dt className="text-sm font-semibold text-neutral-600">{item.label}</dt>
          <dd className="text-base text-neutral-950">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
