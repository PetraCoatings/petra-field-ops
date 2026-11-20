"use client";

import { Trash2 } from "lucide-react";
import { deleteSavedCalculation } from "@/lib/actions/saved-calculations";

/** Small delete button with a confirmation, for one saved calculation. */
export function DeleteSavedButton({ id, projectId, label, confirm }: { id: string; projectId: string; label: string; confirm: string }) {
  return (
    <form
      action={deleteSavedCalculation}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        aria-label={label}
        className="flex size-11 items-center justify-center rounded-lg text-neutral-600 hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 aria-hidden className="size-5" />
      </button>
    </form>
  );
}
