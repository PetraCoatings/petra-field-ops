import "server-only";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Step, WorkOrderContent } from "@/domain/work-orders/content";
import { PETRA_LOGO_PNG } from "./pdf-logo";
import { type ProjectSnapshot, snapshotAddress } from "./snapshot";

/**
 * A published work order revision as a printable PDF (US Letter), laid out
 * like Petra's paper work order: header with logo, job and contacts; job
 * summary table; trailer and jobsite materials side by side; mix ratios;
 * day-by-day schedule; optional sections; drawings, one per page.
 *
 * Uses the built-in Helvetica font (Latin characters, including Spanish).
 */

export type PdfLabels = {
  workOrder: string;
  workOrderN: string; // "Work order 1"
  revisionLine: string; // "Revision 2 · published Nov 21, 2026"
  contactInfo: string;
  summary: string;
  trailer: string;
  qty: string;
  jobsite: string;
  mixRatios: string;
  schedule: string;
  safety: string;
  qcTests: string;
  target: string; // "Target"
  notes: string;
  attachments: string;
  attachedPdf: string; // "PDF attached in the app"
  products: string;
  sheetsInApp: string; // "TDS and SDS in the app"
  important: string;
  page: string; // "Page"
  of: string; // "of"
};

export type PdfDay = { title: string; when: string | null; steps: Step[] };
export type PdfImage = { name: string; caption: string | null; data: Buffer; format: "png" | "jpg" };

// Never split words with hyphens ("bring-ing"); wrap whole words only.
Font.registerHyphenationCallback((word) => [word]);

const BRAND = "#173f73";
const RED = "#991b1b";
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 10, color: "#111" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  brand: { flexDirection: "row", alignItems: "center" },
  logo: { width: 40, height: 40, marginRight: 8 },
  woLabel: { fontFamily: "Helvetica-Bold", fontSize: 13, color: BRAND },
  woSub: { fontSize: 9, color: "#444", marginTop: 2 },
  jobBlock: { alignItems: "flex-end", maxWidth: 330 },
  jobName: { fontFamily: "Helvetica-Bold", fontSize: 16, textAlign: "right" },
  small: { fontSize: 9, color: "#333", textAlign: "right", marginTop: 2 },
  contactHead: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 6, textAlign: "right" },
  contact: { fontSize: 10, textAlign: "right", marginTop: 1 },
  table: { borderWidth: 1, borderColor: "#333", marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#999" },
  lastRow: { flexDirection: "row" },
  labelCell: { width: 110, padding: 4, fontFamily: "Helvetica-Bold", backgroundColor: "#f0f0f0", borderRightWidth: 1, borderColor: "#999" },
  cell: { flex: 1, padding: 4 },
  qtyCell: { width: 90, padding: 4, borderLeftWidth: 1, borderColor: "#999", textAlign: "right" },
  thGrey: { padding: 4, fontFamily: "Helvetica-Bold", textAlign: "center", backgroundColor: "#d9d9d9", borderBottomWidth: 1, borderColor: "#333" },
  thBlue: { padding: 4, fontFamily: "Helvetica-Bold", textAlign: "center", backgroundColor: BRAND, color: "#fff", borderBottomWidth: 1, borderColor: "#333" },
  thSky: { padding: 4, fontFamily: "Helvetica-Bold", textAlign: "center", backgroundColor: "#8ec5ff", borderBottomWidth: 1, borderColor: "#333" },
  twoCol: { flexDirection: "row", marginBottom: 12 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, textDecoration: "underline", marginBottom: 4, marginTop: 4 },
  dayTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 8, marginBottom: 2 },
  step: { flexDirection: "row", marginBottom: 2 },
  stepNum: { width: 18 },
  stepText: { flex: 1 },
  stepImportant: { flex: 1, fontFamily: "Helvetica-Bold", color: RED },
  para: { marginBottom: 6, lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#555" },
  imageCaption: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 8 },
  image: { objectFit: "contain", maxHeight: 640 },
});

function StepList({ steps, importantLabel, bullets = false }: { steps: Step[]; importantLabel: string; bullets?: boolean }) {
  return (
    <View>
      {steps.map((st, i) => (
        <View key={i} style={s.step} wrap={false}>
          <Text style={st.important ? [s.stepNum, { color: RED, fontFamily: "Helvetica-Bold" }] : s.stepNum}>{bullets ? "•" : `${i + 1})`}</Text>
          <Text style={st.important ? s.stepImportant : s.stepText}>
            {st.important ? `${importantLabel.toUpperCase()}: ` : ""}
            {st.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The work order's pages, for the work order PDF or inside a larger PDF (job closeout package). */
export function WorkOrderPages({
  labels: L,
  title,
  project,
  content: c,
  days,
  images,
  pdfAttachments,
}: {
  labels: PdfLabels;
  title: string;
  project: ProjectSnapshot;
  content: WorkOrderContent;
  /** Schedule days with their date/start time already formatted. */
  days: PdfDay[];
  images: PdfImage[];
  pdfAttachments: { name: string; caption: string | null; url: string | null }[];
}) {
  const address = snapshotAddress(project);
  const summary = c.summary.filter((r) => r.value.trim());
  const contacts = project.contacts ?? [];
  const rows = Math.max(c.trailerMaterials.length, c.jobsiteMaterials.length);

  return (
    <>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.brand}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
            <Image src={{ data: PETRA_LOGO_PNG, format: "png" }} style={s.logo} />
            <View>
              <Text style={s.woLabel}>{L.workOrder.toUpperCase()}</Text>
              <Text style={s.woSub}>
                {L.workOrderN} · {title}
              </Text>
              <Text style={s.woSub}>{L.revisionLine}</Text>
            </View>
          </View>
          <View style={s.jobBlock}>
            <Text style={s.jobName}>{project.name}</Text>
            {project.customer && <Text style={s.small}>{project.customer}</Text>}
            {address && <Text style={s.small}>{address}</Text>}
            {contacts.length > 0 && <Text style={s.contactHead}>{L.contactInfo}</Text>}
            {contacts.map((p, i) => (
              <Text key={i} style={s.contact}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}</Text>
                {p.title ? ` (${p.title})` : ""}
                {p.phone ? `: ${p.phone}` : ""}
              </Text>
            ))}
          </View>
        </View>

        {summary.length > 0 && (
          <View style={s.table} wrap={false}>
            {summary.map((r, i) => (
              <View key={i} style={i === summary.length - 1 ? s.lastRow : s.row}>
                <Text style={s.labelCell}>{r.label}:</Text>
                <Text style={s.cell}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}

        {rows > 0 && (
          <View style={s.twoCol}>
            {c.trailerMaterials.length > 0 && (
              <View style={[s.table, { flex: 3, marginBottom: 0, marginRight: c.jobsiteMaterials.length ? 8 : 0 }]}>
                <Text style={s.thGrey}>{L.trailer.toUpperCase()}</Text>
                {c.trailerMaterials.map((m, i) => (
                  <View key={i} style={i === c.trailerMaterials.length - 1 ? s.lastRow : s.row} wrap={false}>
                    <Text style={s.cell}>{m.item}</Text>
                    <Text style={s.qtyCell}>{m.qty ?? ""}</Text>
                  </View>
                ))}
              </View>
            )}
            {c.jobsiteMaterials.length > 0 && (
              <View style={[s.table, { flex: 2, marginBottom: 0 }]}>
                <Text style={s.thBlue}>{L.jobsite.toUpperCase()}</Text>
                {c.jobsiteMaterials.map((m, i) => (
                  <View key={i} style={i === c.jobsiteMaterials.length - 1 ? s.lastRow : s.row} wrap={false}>
                    <Text style={s.cell}>
                      {m.item}
                      {m.note ? ` (${m.note})` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {c.mixRatios.length > 0 && (
          <View style={[s.table, { width: "75%" }]} wrap={false}>
            <Text style={s.thSky}>{L.mixRatios.toUpperCase()}</Text>
            {c.mixRatios.map((m, i) => (
              <View key={i} style={i === c.mixRatios.length - 1 ? s.lastRow : s.row}>
                <Text style={s.cell}>{m.product}</Text>
                <Text style={[s.cell, { borderLeftWidth: 1, borderColor: "#999", fontFamily: "Helvetica-Bold" }]}>{m.ratio}</Text>
              </View>
            ))}
          </View>
        )}

        {c.products.length > 0 && (
          <View wrap={false} style={{ marginBottom: 8 }}>
            <Text style={s.sectionTitle}>{L.products.toUpperCase()}:</Text>
            {c.products.map((p, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                • <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}</Text>
                {p.manufacturer ? ` (${p.manufacturer})` : ""}
              </Text>
            ))}
            <Text style={{ fontSize: 8.5, color: "#555", marginTop: 2 }}>{L.sheetsInApp}</Text>
          </View>
        )}

        {days.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>{L.schedule.toUpperCase()}:</Text>
            {days.map((d, i) => (
              <View key={i}>
                <Text style={s.dayTitle} minPresenceAhead={30}>
                  {d.title}
                  {d.when ? ` · ${d.when}` : ""}
                </Text>
                <StepList steps={d.steps} importantLabel={L.important} />
              </View>
            ))}
          </View>
        )}

        {c.safety.length > 0 && (
          <View wrap={false}>
            <Text style={s.sectionTitle}>{L.safety.toUpperCase()}:</Text>
            <StepList steps={c.safety} importantLabel={L.important} bullets />
          </View>
        )}

        {c.qcTests.length > 0 && (
          <View wrap={false}>
            <Text style={s.sectionTitle}>{L.qcTests.toUpperCase()}:</Text>
            {c.qcTests.map((q, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                • <Text style={{ fontFamily: "Helvetica-Bold" }}>{q.test}</Text>
                {q.target ? ` (${L.target}: ${q.target})` : ""}
              </Text>
            ))}
          </View>
        )}

        {c.notes.trim() !== "" && (
          <View>
            <Text style={s.sectionTitle}>{L.notes.toUpperCase()}:</Text>
            <Text style={s.para}>{c.notes}</Text>
          </View>
        )}

        {c.customSections.map((cs, i) => (
          <View key={i}>
            <Text style={s.sectionTitle}>{cs.title.toUpperCase()}:</Text>
            <Text style={s.para}>{cs.body}</Text>
          </View>
        ))}

        {pdfAttachments.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>{L.attachments.toUpperCase()}:</Text>
            {pdfAttachments.map((a, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                • {a.caption || a.name} ({L.attachedPdf})
                {a.url ? (
                  <>
                    {" "}
                    <Link src={a.url}>{a.name}</Link>
                  </>
                ) : null}
              </Text>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>
            {project.name} · {L.workOrderN} · {L.revisionLine}
          </Text>
        </View>
      </Page>

      {images.map((img, i) => (
        <Page key={i} size="LETTER" orientation="landscape" style={s.page}>
          <Text style={s.imageCaption}>{img.caption || img.name}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
          <Image src={{ data: img.data, format: img.format }} style={[s.image, { maxHeight: 460 }]} />
          <View style={s.footer} fixed>
            <Text>
              {project.name} · {L.workOrderN} · {L.revisionLine}
            </Text>
          </View>
        </Page>
      ))}
    </>
  );
}

export function WorkOrderPdf(props: Parameters<typeof WorkOrderPages>[0]) {
  return (
    <Document title={`${props.project.name ?? ""} - ${props.title}`} author="Petra Field Operations" creator="Petra Field Operations">
      <WorkOrderPages {...props} />
    </Document>
  );
}

/** Renders the work order PDF to bytes. */
export async function renderWorkOrderPdf(props: Parameters<typeof WorkOrderPdf>[0]): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(<WorkOrderPdf {...props} />);
}
