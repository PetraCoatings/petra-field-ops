import Link from "next/link";
import { BackLinkIcon } from "./link-pending";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  backHref,
  backLabel,
  actions,
}: {
  title: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 space-y-2">
      {backHref && (
        <Link
          href={backHref}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-base font-semibold text-brand-700"
        >
          <BackLinkIcon />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-950 sm:text-3xl">{title}</h1>
        {actions}
      </div>
    </div>
  );
}
