"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextArea, TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { type CustomerRow, type DirectoryRow, PROJECT_STATUSES, type ProjectRow } from "@/lib/db/types";
import { type FormState, idle } from "@/lib/forms/form-state";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  project?: ProjectRow;
  customers: CustomerRow[];
  managers: DirectoryRow[];
  leads: DirectoryRow[];
};

export function ProjectForm({ action, project, customers, managers, leads }: Props) {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, formAction] = useActionState(action, idle);
  const err = (k: string) => rt(state.fieldErrors?.[k]);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("projects.name")} name="name" defaultValue={project?.name} required error={err("name")} />
        <TextField label={t("projects.jobNumber")} name="job_number" defaultValue={project?.job_number ?? ""} error={err("job_number")} />
        <SelectField label={t("projects.customer")} name="customer_id" defaultValue={project?.customer_id ?? ""}>
          <option value="">{t("projects.selectCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t("projects.newCustomerName")} name="new_customer" />
        <SelectField label={t("projects.status")} name="status" defaultValue={project?.status ?? "draft"} error={err("status")}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`jobs.status.${s}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("projects.flooringSystem")} name="flooring_system" defaultValue={project?.flooring_system ?? ""} />
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-bold">{t("jobs.address")}</legend>
        <div className="sm:col-span-2">
          <TextField label={t("projects.street")} name="site_street" defaultValue={project?.site_street ?? ""} autoComplete="off" />
        </div>
        <TextField label={t("projects.city")} name="site_city" defaultValue={project?.site_city ?? ""} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label={t("projects.state")} name="site_state" defaultValue={project?.site_state ?? "TX"} />
          <TextField label={t("projects.postalCode")} name="site_postal_code" defaultValue={project?.site_postal_code ?? ""} inputMode="numeric" />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t("projects.projectManager")} name="project_manager_id" defaultValue={project?.project_manager_id ?? ""}>
          <option value="">{t("projects.noneSelected")}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("projects.crewLead")} name="crew_lead_id" defaultValue={project?.crew_lead_id ?? ""}>
          <option value="">{t("projects.noneSelected")}</option>
          {leads.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </SelectField>
        <TextField label={t("projects.startDate")} name="scheduled_start" type="date" defaultValue={project?.scheduled_start ?? ""} error={err("scheduled_start")} />
        <TextField
          label={t("projects.durationDays")}
          name="estimated_duration_days"
          inputMode="numeric"
          defaultValue={project?.estimated_duration_days ?? ""}
          error={err("estimated_duration_days")}
        />
        <TextField
          label={t("projects.totalSqft")}
          name="total_sqft"
          inputMode="decimal"
          defaultValue={project?.total_sqft ?? ""}
          error={err("total_sqft")}
        />
      </div>
      <TextArea label={t("projects.scope")} name="scope_summary" defaultValue={project?.scope_summary ?? ""} rows={6} />
      <SubmitButton pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
    </form>
  );
}
