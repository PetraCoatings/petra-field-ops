import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DailyReportsCard } from "@/components/reports/daily-reports-card";
import { recentReports } from "@/lib/reports/list";
import { SavedCalculations } from "@/components/calculators/saved-calculations";
import { ProjectWorkOrders } from "@/components/work-orders/project-work-orders";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { AssignmentRow, ProjectContactRow, ProjectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { addAssignment, addContact, removeAssignment, removeContact, updateProject } from "../actions";
import { ContactsSection, CrewSection } from "../crew-section";
import { ProjectForm } from "../project-form";
import { projectFormOptions } from "../project-options";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: t("editTitle") };
}

export default async function EditProjectPage({ params, searchParams }: PageProps<"/manage/projects/[id]">) {
  const profile = await requireRole("project_manager", "office_admin");
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*, project_contacts(*), project_assignments(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const project = data as ProjectRow & { project_contacts: ProjectContactRow[]; project_assignments: AssignmentRow[] };
  const { customers, managers, leads, people } = await projectFormOptions();
  const t = await getTranslations();

  const byId = new Map(people.map((p) => [p.id, p]));
  const assignedIds = new Set(project.project_assignments.map((a) => a.employee_id));
  const crew = project.project_assignments
    .map((a) => ({ assignmentId: a.id, name: byId.get(a.employee_id)?.display_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <PageHeader
        title={project.name}
        backHref="/manage/projects"
        backLabel={t("projects.title")}
        actions={
          <Link href={`/jobs/${project.id}`} className="font-semibold text-brand-700 underline">
            {t("common.fieldApp")}
          </Link>
        }
      />
      {created && <Alert tone="success">{t("projects.created")}</Alert>}
      <ProjectWorkOrders projectId={project.id} />
      <Card title={t("projects.editTitle")}>
        <ProjectForm
          action={updateProject.bind(null, project.id)}
          project={project}
          customers={customers}
          managers={managers}
          leads={leads}
        />
      </Card>
      <Card title={t("projects.crew")}>
        <CrewSection
          crew={crew}
          available={people.filter((p) => !assignedIds.has(p.id))}
          addAction={addAssignment.bind(null, project.id)}
          removeAction={removeAssignment.bind(null, project.id)}
        />
      </Card>
      <Card title={t("projects.contacts")}>
        <ContactsSection
          contacts={project.project_contacts}
          addAction={addContact.bind(null, project.id)}
          removeAction={removeContact.bind(null, project.id)}
        />
      </Card>
      <DailyReportsCard projectId={project.id} reports={await recentReports(project.id, 30)} canWrite={false} today="" />
      <SavedCalculations projectId={project.id} profile={profile} />
    </div>
  );
}
