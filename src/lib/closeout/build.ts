import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import type { DfrContent } from "@/domain/reports/dfr";
import { SPREAD_VARIANCE_FLAG_PCT } from "@/domain/reports/dfr";
import { limitText } from "@/domain/reports/qc";
import { directoryNames } from "@/lib/db/queries";
import type { createClient } from "@/lib/supabase/server";
import { workOrderPdfProps } from "@/lib/work-orders/pdf-props";
import type { CloseoutBlock, CloseoutModel, CloseoutPhoto, CloseoutReport } from "./pdf";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** At most this many photos go in one package (oldest first). */
export const MAX_PHOTOS = 150;

/**
 * Gathers a job's closeout package: cover, current work order revision(s),
 * the latest submitted version of every daily report, QC readings, jobsite
 * issues and photos. Read with the person's own access (office staff see
 * everything on the job). `photoPx` is the long edge photos are shrunk to.
 */
export async function buildCloseout(supabase: Supabase, projectId: string, photoPx: number): Promise<{ model: CloseoutModel; fileName: string; drawings: Buffer[][] } | null> {
  const { data: job } = await supabase
    .from("projects")
    .select("id, name, job_number, site_street, site_city, site_state, site_postal_code, project_manager_id, crew_lead_id, status, customers(name)")
    .eq("id", projectId)
    .maybeSingle();
  if (!job) return null;
  const t = await getTranslations();
  const format = await getFormatter();
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const n1 = (x: number) => format.number(x, { maximumFractionDigits: 1 });

  const [{ data: fwos }, { data: dfrs }, { data: qcRows }, { data: qcTypes }, { data: issueRows }, { data: photoRows }] = await Promise.all([
    supabase.from("field_work_orders").select("id, fwo_number").eq("project_id", projectId).eq("status", "published").order("fwo_number"),
    supabase.from("daily_field_reports").select("id, report_date, status, accepted_by, accepted_at").eq("project_id", projectId).order("report_date"),
    supabase.from("qc_measurements").select("*").eq("project_id", projectId).order("measured_at"),
    supabase.from("qc_test_types").select("id, code, name"),
    supabase.from("jobsite_issues").select("*").eq("project_id", projectId).order("created_at"),
    supabase.from("photos").select("id, stage, notes, taken_at, created_at, uploaded_by, storage_path").eq("project_id", projectId).order("created_at").limit(MAX_PHOTOS + 1),
  ]);

  // Work orders: the current published revision of each.
  const workOrders = [];
  const drawings: Buffer[][] = [];
  for (const f of fwos ?? []) {
    const built = await workOrderPdfProps(supabase, f.id as string, null);
    if (built) {
      workOrders.push(built.props);
      drawings.push(built.attachedPdfs);
    }
  }

  // Daily reports: the latest submitted version of each (drafts never submitted are only listed).
  const reports = (dfrs ?? []) as { id: string; report_date: string; status: string; accepted_by: string | null; accepted_at: string | null }[];
  const { data: versionRows } = reports.length
    ? await supabase.from("dfr_versions").select("dfr_id, version_number, content, submitted_by, submitted_at").in("dfr_id", reports.map((r) => r.id)).order("version_number", { ascending: false })
    : { data: [] };
  const latest = new Map<string, { version_number: number; content: DfrContent; submitted_by: string | null; submitted_at: string }>();
  for (const v of (versionRows ?? []) as { dfr_id: string; version_number: number; content: DfrContent; submitted_by: string | null; submitted_at: string }[]) {
    if (!latest.has(v.dfr_id)) latest.set(v.dfr_id, v);
  }

  const qc = (qcRows ?? []) as { test_type_id: string; value: string; unit: string; location: string | null; measured_at: string; measured_by: string | null; criteria_min: string | null; criteria_max: string | null; result: string | null; inputs: { airTempF: number; humidityPct: number; surfaceTempF: number; dewPointF: number } | null }[];
  const issues = (issueRows ?? []) as { type: string; description: string; status: string; reported_by: string | null; created_at: string; resolved_by: string | null; resolved_at: string | null; resolution_note: string | null }[];
  const photos = (photoRows ?? []) as { stage: string; notes: string | null; taken_at: string | null; created_at: string; uploaded_by: string | null; storage_path: string }[];
  const names = await directoryNames([
    job.project_manager_id as string | null,
    job.crew_lead_id as string | null,
    ...reports.map((r) => r.accepted_by),
    ...[...latest.values()].map((v) => v.submitted_by),
    ...qc.map((q) => q.measured_by),
    ...issues.flatMap((i) => [i.reported_by, i.resolved_by]),
    ...photos.map((p) => p.uploaded_by),
  ]);
  const name = (id: string | null) => (id ? (names.get(id)?.display_name ?? "?") : "?");

  const reportSections: CloseoutReport[] = [];
  const notAccepted: string[] = [];
  const neverSubmitted: string[] = [];
  for (const r of reports) {
    const v = latest.get(r.id);
    if (!v) {
      neverSubmitted.push(day(r.report_date));
      continue;
    }
    if (r.status !== "accepted") notAccepted.push(`${day(r.report_date)} (${t(`reports.statuses.${r.status as "submitted"}`)})`);
    const c = v.content;
    const blocks: CloseoutBlock[] = [];
    if (c.crew?.length) blocks.push({ title: t("reports.crew"), lines: [c.crew.map((x) => x.name).join(", ")] });
    if (c.workPerformed) blocks.push({ title: t("reports.workPerformed"), lines: c.workPerformed.split("\n") });
    if (c.areas || c.sqftCompleted !== undefined)
      blocks.push({ title: t("reports.areas"), lines: [[c.areas, c.sqftCompleted !== undefined ? t("reports.sqftValue", { sqft: format.number(c.sqftCompleted) }) : null].filter(Boolean).join(" · ")] });
    if (c.readings?.length) {
      const lines: string[] = [];
      let warn = false;
      for (const rd of c.readings) {
        const deg = `°${rd.unit}`;
        let line = [rd.time, t("reports.readingLine", { air: `${n1(rd.airTemp)} ${deg}`, rh: `${n1(rd.relativeHumidity)}%` })].filter(Boolean).join(" · ");
        if (rd.substrateTemp !== undefined) line += ` · ${t("reports.surface", { temp: `${n1(rd.substrateTemp)} ${deg}` })}`;
        if (rd.productName) line += ` · ${rd.productName}`;
        const res = rd.result;
        if (res) {
          line += ` · ${t("reports.dewPointLine", { dp: `${res.dewPoint} ${deg}` })}`;
          if (res.status) {
            line += ` · ${t(`reports.status.${res.status}`, { spread: `${Math.abs(res.spread ?? 0).toFixed(1)} ${deg}`, margin: `${res.margin} ${deg}` })}`;
            if (res.status !== "ok") warn = true;
          }
        }
        lines.push(line);
      }
      blocks.push({ title: t("reports.readings"), lines, warn });
    }
    if (c.materials?.length) {
      const lines = c.materials.map((m) => {
        let line = `${m.product}${m.lot ? ` · ${t("reports.lotValue", { lot: m.lot })}` : ""}: ${t("reports.materialLine", { gallons: n1(m.gallons), area: format.number(m.areaSqft), coats: m.coats ?? 1 })}`;
        if (m.result) line += ` · ${t("reports.actualRate", { rate: n1(m.result.actualSpreadRate) })}`;
        if (m.result?.targetSpreadRate !== undefined)
          line += ` (${t("reports.targetRate", { rate: n1(m.result.targetSpreadRate), pct: `${m.result.variancePct! > 0 ? "+" : ""}${m.result.variancePct}` })})`;
        if (m.result?.variancePct !== undefined && Math.abs(m.result.variancePct) > SPREAD_VARIANCE_FLAG_PCT) line += ` · ${t("reports.spreadFlag", { pct: SPREAD_VARIANCE_FLAG_PCT })}`;
        return line;
      });
      blocks.push({ title: t("reports.materials"), lines });
    }
    if (c.notes) blocks.push({ title: t("reports.notes"), lines: c.notes.split("\n") });
    if (c.nextSteps) blocks.push({ title: t("reports.nextSteps"), lines: c.nextSteps.split("\n") });
    reportSections.push({
      heading: day(r.report_date),
      status: t(`reports.statuses.${r.status as "submitted"}`),
      meta: [
        t("reports.submittedBy", { name: name(v.submitted_by), when: when(v.submitted_at), version: v.version_number }),
        ...(r.status === "accepted" && r.accepted_at ? [t("reports.acceptedBy", { name: name(r.accepted_by), when: when(r.accepted_at) })] : []),
      ],
      blocks,
    });
  }

  // QC readings table.
  const typeName = new Map(((qcTypes ?? []) as { id: string; code: string; name: string }[]).map((x) => [x.id, t.has(`qc.types.${x.code}` as "qc.types.ph") ? t(`qc.types.${x.code}` as "qc.types.ph") : x.name]));
  const qcTable = qc.length
    ? {
        headers: [t("closeout.qcTest"), t("closeout.qcReading"), t("closeout.qcResult"), t("closeout.qcWhere"), t("closeout.qcWhen")],
        rows: qc.map((q) => {
          const limit = limitText(q.criteria_min === null ? null : Number(q.criteria_min), q.criteria_max === null ? null : Number(q.criteria_max), q.unit, (x) => format.number(x));
          const reading = `${format.number(Number(q.value))} ${q.unit}${
            q.inputs ? `\n${t("qc.dewPointDetails", { air: n1(q.inputs.airTempF), rh: n1(q.inputs.humidityPct), surface: n1(q.inputs.surfaceTempF), dew: n1(q.inputs.dewPointF) })}` : ""
          }`;
          const result = q.result ? `${t(`qc.${q.result as "pass"}`)}${limit ? ` (${limit})` : ""}` : t("qc.recordedOnly");
          return [typeName.get(q.test_type_id) ?? "?", reading, result, q.location ?? "", `${when(q.measured_at)}\n${name(q.measured_by)}`];
        }),
      }
    : null;

  const issueBlocks: CloseoutBlock[] = issues.map((i) => ({
    title: `${t(`issues.types.${i.type as "other"}`)} · ${when(i.created_at)} · ${name(i.reported_by)}`,
    lines: [
      i.description,
      i.status === "resolved"
        ? t("closeout.resolved", { name: name(i.resolved_by), when: i.resolved_at ? when(i.resolved_at) : "", note: i.resolution_note ?? "" })
        : t("closeout.stillOpen"),
    ],
    warn: i.status !== "resolved",
  }));

  // Photos, shrunk for print.
  const shown = photos.slice(0, MAX_PHOTOS);
  const sharp = (await import("sharp")).default;
  const photoItems: CloseoutPhoto[] = [];
  const queue = [...shown.entries()];
  const results: (CloseoutPhoto | null)[] = new Array(shown.length).fill(null);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [idx, p] = next;
        try {
          const { data: blob } = await supabase.storage.from("job-photos").download(p.storage_path);
          if (!blob) continue;
          const data = await sharp(Buffer.from(await blob.arrayBuffer()))
            .rotate()
            .resize({ width: photoPx, height: photoPx, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer();
          results[idx] = {
            caption: t(`photos.stages.${p.stage as "other"}`),
            sub: [when(p.taken_at ?? p.created_at), name(p.uploaded_by)].join(" · "),
            notes: p.notes,
            data,
          };
        } catch {
          // A photo that can't be read is left out rather than failing the package.
        }
      }
    }),
  );
  for (const r of results) if (r) photoItems.push(r);

  const address = [job.site_street, [job.site_city, job.site_state].filter(Boolean).join(", "), job.site_postal_code].filter(Boolean).join(" ");
  const customer = (job.customers as unknown as { name: string } | null)?.name;
  const dates = reports.length ? t("closeout.reportDates", { first: day(reports[0].report_date), last: day(reports[reports.length - 1].report_date) }) : null;
  const warnings = [
    ...(notAccepted.length ? [t("closeout.notAccepted", { list: notAccepted.join(", ") })] : []),
    ...(neverSubmitted.length ? [t("closeout.neverSubmitted", { list: neverSubmitted.join(", ") })] : []),
    ...(photos.length > MAX_PHOTOS ? [t("closeout.tooManyPhotos", { max: MAX_PHOTOS })] : []),
  ];
  const model: CloseoutModel = {
    labels: {
      title: t("closeout.title"),
      contents: t("closeout.contents"),
      dailyReports: t("closeout.dailyReports"),
      qc: t("closeout.qc"),
      issues: t("closeout.issues"),
      photos: t("closeout.photos"),
      page: t("workOrders.pdf.page"),
      of: t("workOrders.pdf.of"),
      none: t("closeout.none"),
    },
    jobName: job.name as string,
    coverLines: [
      job.job_number ? t("closeout.jobNumber", { n: job.job_number as string }) : null,
      customer ? t("closeout.customer", { name: customer }) : null,
      address ? t("closeout.address", { address }) : null,
      job.project_manager_id ? t("closeout.pm", { name: name(job.project_manager_id as string) }) : null,
      job.crew_lead_id ? t("closeout.crewLead", { name: name(job.crew_lead_id as string) }) : null,
      dates,
    ].filter((x): x is string => Boolean(x)),
    contents: [
      t("closeout.contentsWorkOrders", { count: workOrders.length }),
      t("closeout.contentsReports", { count: reportSections.length }),
      t("closeout.contentsQc", { count: qc.length }),
      t("closeout.contentsIssues", { count: issues.length }),
      t("closeout.contentsPhotos", { count: photoItems.length }),
    ],
    warnings,
    generated: t("closeout.generated", { when: when(new Date().toISOString()) }),
    workOrders,
    reports: reportSections,
    qc: qcTable,
    issues: issueBlocks,
    photos: photoItems,
  };
  const fileName = `${job.name} - Closeout package.pdf`.replace(/[^\w .,()-]+/g, "_");
  return { model, fileName, drawings };
}
