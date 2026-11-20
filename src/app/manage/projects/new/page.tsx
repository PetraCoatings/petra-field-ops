import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { createProject } from "../actions";
import { ProjectForm } from "../project-form";
import { projectFormOptions } from "../project-options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: t("newTitle") };
}

export default async function NewProjectPage() {
  await requireRole("project_manager", "office_admin");
  const t = await getTranslations();
  const { customers, managers, leads } = await projectFormOptions();
  return (
    <>
      <PageHeader title={t("projects.newTitle")} backHref="/manage/projects" backLabel={t("projects.title")} />
      <Card>
        <ProjectForm action={createProject} customers={customers} managers={managers} leads={leads} />
      </Card>
    </>
  );
}
