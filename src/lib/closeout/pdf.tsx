import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PETRA_LOGO_PNG } from "@/lib/work-orders/pdf-logo";
import { WorkOrderPages } from "@/lib/work-orders/pdf";
import type { WorkOrderPdfProps } from "@/lib/work-orders/pdf-props";

/**
 * The job closeout package: one PDF with a cover page, the job's work
 * order(s), every submitted daily report, the QC readings, jobsite issues and
 * all job photos. Everything arrives already translated and formatted (see
 * build.ts); this file only lays it out.
 */

export type CloseoutBlock = { title: string; lines: string[]; warn?: boolean };
export type CloseoutReport = { heading: string; status: string; meta: string[]; blocks: CloseoutBlock[] };
export type CloseoutPhoto = { caption: string; sub: string; notes: string | null; data: Buffer };
export type CloseoutModel = {
  labels: { title: string; contents: string; dailyReports: string; qc: string; issues: string; photos: string; page: string; of: string; none: string };
  jobName: string;
  coverLines: string[];
  contents: string[];
  warnings: string[];
  generated: string;
  workOrders: WorkOrderPdfProps[];
  reports: CloseoutReport[];
  qc: { headers: string[]; rows: string[][] } | null;
  issues: CloseoutBlock[];
  photos: CloseoutPhoto[];
};

const BRAND = "#173f73";
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 10, color: "#111" },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  logo: { width: 48, height: 48, marginRight: 10 },
  brandName: { fontFamily: "Helvetica-Bold", fontSize: 14, color: BRAND },
  coverTitle: { fontFamily: "Helvetica-Bold", fontSize: 24, color: BRAND, marginBottom: 6 },
  jobName: { fontFamily: "Helvetica-Bold", fontSize: 18, marginBottom: 12 },
  line: { fontSize: 11, marginBottom: 3 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 14, color: BRAND, marginTop: 16, marginBottom: 6 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 13, marginBottom: 2 },
  status: { fontFamily: "Helvetica-Bold", fontSize: 10, color: BRAND, marginBottom: 4 },
  meta: { fontSize: 9, color: "#444", marginBottom: 2 },
  warnBox: { borderWidth: 1, borderColor: "#b45309", backgroundColor: "#fffbeb", padding: 8, marginTop: 12 },
  warnText: { fontSize: 10, color: "#78350f", marginBottom: 2 },
  block: { marginTop: 8 },
  blockTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#555", textTransform: "uppercase", marginBottom: 2 },
  blockLine: { fontSize: 10, lineHeight: 1.35 },
  warnLine: { fontSize: 10, lineHeight: 1.35, color: "#991b1b", fontFamily: "Helvetica-Bold" },
  table: { borderWidth: 1, borderColor: "#999" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#ddd" },
  th: { flex: 1, padding: 3, fontFamily: "Helvetica-Bold", fontSize: 8.5, backgroundColor: "#eef2f7" },
  td: { flex: 1, padding: 3, fontSize: 8.5 },
  photoRow: { marginBottom: 14 },
  photo: { objectFit: "contain", maxHeight: 300, marginBottom: 4 },
  photoCaption: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  photoSub: { fontSize: 9, color: "#444" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#555" },
});

function Footer({ m }: { m: CloseoutModel }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {m.jobName} · {m.labels.title}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${m.labels.page} ${pageNumber} ${m.labels.of} ${totalPages}`} />
    </View>
  );
}

function Blocks({ blocks }: { blocks: CloseoutBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <View key={i} style={s.block} wrap>
          <Text style={s.blockTitle}>{b.title}</Text>
          {b.lines.map((l, j) => (
            <Text key={j} style={b.warn ? s.warnLine : s.blockLine}>
              {l}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

export function CloseoutPdf({ m }: { m: CloseoutModel }) {
  const pairs: CloseoutPhoto[][] = [];
  for (let i = 0; i < m.photos.length; i += 2) pairs.push(m.photos.slice(i, i + 2));
  return (
    <Document title={`${m.jobName} - ${m.labels.title}`} author="Petra Field Operations" creator="Petra Field Operations">
      {/* Cover */}
      <Page size="LETTER" style={s.page}>
        <View style={s.brand}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
          <Image src={{ data: PETRA_LOGO_PNG, format: "png" }} style={s.logo} />
          <Text style={s.brandName}>Petra Coatings</Text>
        </View>
        <Text style={s.coverTitle}>{m.labels.title}</Text>
        <Text style={s.jobName}>{m.jobName}</Text>
        {m.coverLines.map((l, i) => (
          <Text key={i} style={s.line}>
            {l}
          </Text>
        ))}
        <Text style={s.h2}>{m.labels.contents}</Text>
        {m.contents.map((l, i) => (
          <Text key={i} style={s.line}>
            • {l}
          </Text>
        ))}
        {m.warnings.length > 0 && (
          <View style={s.warnBox}>
            {m.warnings.map((w, i) => (
              <Text key={i} style={s.warnText}>
                {w}
              </Text>
            ))}
          </View>
        )}
        <Text style={[s.meta, { marginTop: 16 }]}>{m.generated}</Text>
        <Footer m={m} />
      </Page>

      {/* Work orders, exactly as their own PDF */}
      {m.workOrders.map((wo, i) => (
        <WorkOrderPages key={`wo-${i}`} {...wo} />
      ))}

      {/* Daily reports: each starts on a new page */}
      {m.reports.map((r, i) => (
        <Page key={`r-${i}`} size="LETTER" style={s.page}>
          {i === 0 && <Text style={[s.h2, { marginTop: 0 }]}>{m.labels.dailyReports}</Text>}
          <Text style={s.h3}>{r.heading}</Text>
          <Text style={s.status}>{r.status}</Text>
          {r.meta.map((l, j) => (
            <Text key={j} style={s.meta}>
              {l}
            </Text>
          ))}
          <Blocks blocks={r.blocks} />
          <Footer m={m} />
        </Page>
      ))}

      {/* QC readings and jobsite issues */}
      {(m.qc || m.issues.length > 0) && (
        <Page size="LETTER" style={s.page}>
          {m.qc && (
            <>
              <Text style={[s.h2, { marginTop: 0 }]}>{m.labels.qc}</Text>
              <View style={s.table}>
                <View style={s.tr} fixed>
                  {m.qc.headers.map((h, i) => (
                    <Text key={i} style={s.th}>
                      {h}
                    </Text>
                  ))}
                </View>
                {m.qc.rows.map((row, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    {row.map((c, j) => (
                      <Text key={j} style={s.td}>
                        {c}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </>
          )}
          {m.issues.length > 0 && (
            <>
              <Text style={s.h2}>{m.labels.issues}</Text>
              <Blocks blocks={m.issues} />
            </>
          )}
          <Footer m={m} />
        </Page>
      )}

      {/* Photos, two per page */}
      {pairs.map((pair, i) => (
        <Page key={`p-${i}`} size="LETTER" style={s.page}>
          {i === 0 && <Text style={[s.h2, { marginTop: 0 }]}>{m.labels.photos}</Text>}
          {pair.map((p, j) => (
            <View key={j} style={s.photoRow} wrap={false}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
              <Image src={{ data: p.data, format: "jpg" }} style={s.photo} />
              <Text style={s.photoCaption}>{p.caption}</Text>
              <Text style={s.photoSub}>{p.sub}</Text>
              {p.notes && <Text style={s.photoSub}>{p.notes}</Text>}
            </View>
          ))}
          <Footer m={m} />
        </Page>
      ))}
    </Document>
  );
}

export async function renderCloseoutPdf(m: CloseoutModel): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(<CloseoutPdf m={m} />);
}
