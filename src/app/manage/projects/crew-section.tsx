"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { X } from "lucide-react";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import type { DirectoryRow } from "@/lib/db/types";
import { type FormState, idle } from "@/lib/forms/form-state";

type Crew = { assignmentId: string; name: string }[];

export function CrewSection({
  crew,
  available,
  addAction,
  removeAction,
}: {
  crew: Crew;
  available: DirectoryRow[];
  addAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  removeAction: (assignmentId: string) => Promise<void>;
}) {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, formAction] = useActionState(addAction, idle);
  return (
    <div className="space-y-4">
      {crew.length === 0 ? (
        <p className="text-neutral-700">{t("projects.crewEmpty")}</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {crew.map((c) => (
            <li key={c.assignmentId} className="flex items-center justify-between gap-2 py-2">
              <span className="text-base">{c.name}</span>
              <form action={removeAction.bind(null, c.assignmentId)}>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-red-700 hover:bg-red-50"
                >
                  <X aria-hidden className="size-4" />
                  {t("common.remove")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <FormMessage state={{ ...state, message: state.status === "error" ? state.message : undefined }} />
          <div className="min-w-56 flex-1">
            <SelectField label={t("projects.addToCrew")} name="employee_id" defaultValue="" error={rt(state.fieldErrors?.employee_id)}>
              <option value="">{t("projects.choosePerson")}</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} — {t(`roles.${p.role}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <SubmitButton pendingLabel={t("common.saving")} size="md">
            {t("common.add")}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

type Contact = { id: string; name: string; title: string | null; phone: string | null; email: string | null };

export function ContactsSection({
  contacts,
  addAction,
  removeAction,
}: {
  contacts: Contact[];
  addAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  removeAction: (contactId: string) => Promise<void>;
}) {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, formAction] = useActionState(addAction, idle);
  return (
    <div className="space-y-4">
      {contacts.length === 0 ? (
        <p className="text-neutral-700">{t("jobs.noContacts")}</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold">
                  {c.name}
                  {c.title && <span className="font-normal text-neutral-700"> · {c.title}</span>}
                </p>
                <p className="text-sm text-neutral-700">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
              </div>
              <form action={removeAction.bind(null, c.id)}>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-red-700 hover:bg-red-50"
                >
                  <X aria-hidden className="size-4" />
                  {t("common.remove")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={formAction} className="space-y-3 rounded-xl bg-neutral-50 p-4">
        <p className="font-semibold">{t("projects.addContact")}</p>
        <FormMessage state={{ ...state, message: state.status === "error" ? state.message : undefined }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("projects.contactName")} name="contact_name" error={rt(state.fieldErrors?.contact_name)} />
          <TextField label={t("projects.contactTitle")} name="contact_title" />
          <TextField label={t("projects.contactPhone")} name="contact_phone" type="tel" />
          <TextField label={t("projects.contactEmail")} name="contact_email" type="email" error={rt(state.fieldErrors?.contact_email)} />
        </div>
        <SubmitButton pendingLabel={t("common.saving")} size="md" variant="secondary">
          {t("projects.addContact")}
        </SubmitButton>
      </form>
    </div>
  );
}
