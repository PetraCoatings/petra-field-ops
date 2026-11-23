import "server-only";
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Payroll } from "./load";

Font.registerHyphenationCallback((word) => [word]);
const BRAND = "#173f73";
const s = StyleSheet.create({
  page: { padding: 28, fontFamily: "Helvetica", fontSize: 9, color: "#111" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 14, color: BRAND },
  sub: { fontSize: 9, color: "#444", marginTop: 2, marginBottom: 10 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#bbb" },
  head: { flexDirection: "row", backgroundColor: "#eef2f7", borderBottomWidth: 1, borderColor: "#333" },
  name: { width: 120, padding: 3 },
  cell: { width: 44, padding: 3, textAlign: "right" },
  week: { borderLeftWidth: 0.5, borderColor: "#999" },
  bold: { fontFamily: "Helvetica-Bold" },
  check: { width: 64, padding: 3, textAlign: "right", borderLeftWidth: 0.5, borderColor: "#999" },
  note: { marginTop: 10, fontSize: 8, color: "#444" },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, fontSize: 7, color: "#666", flexDirection: "row", justifyContent: "space-between" },
});

export type PayrollPdfLabels = {
  title: string;
  period: string;
  employee: string;
  weeks: string[];
  job: string;
  drive: string;
  ride: string;
  total: string;
  overtime: string;
  check: string;
  salaried: string;
  note: string;
  blocked: string | null;
  generated: string;
};

export function PayrollPdf({ p, labels }: { p: Payroll; labels: PayrollPdfLabels }) {
  const h = (n: number) => (n === 0 ? "" : (n / 100).toFixed(2));
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Document title={`${labels.title} ${labels.period}`}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Text style={s.title}>{labels.title}</Text>
        <Text style={s.sub}>{labels.period}</Text>
        {labels.blocked && <Text style={[s.sub, { color: "#991b1b" }]}>{labels.blocked}</Text>}
        <View style={s.head}>
          <Text style={[s.name, s.bold]}> </Text>
          {labels.weeks.map((w) => (
            <Text key={w} style={[s.bold, s.week, { width: 220, padding: 3, textAlign: "center" }]}>
              {w}
            </Text>
          ))}
          <Text style={[s.check, s.bold]}> </Text>
        </View>
        <View style={s.head} fixed>
          <Text style={[s.name, s.bold]}>{labels.employee}</Text>
          {labels.weeks.map((w) =>
            [labels.job, labels.drive, labels.ride, labels.total, labels.overtime].map((l, i) => (
              <Text key={`${w}${l}`} style={[s.cell, s.bold, i === 0 ? s.week : {}]}>
                {l}
              </Text>
            )),
          )}
          <Text style={[s.check, s.bold]}>{labels.check}</Text>
        </View>
        {p.rows.map((r) => (
          <View key={r.employeeId} style={s.row} wrap={false}>
            <Text style={s.name}>
              {r.name}
              {r.exempt ? `\n${labels.salaried}` : ""}
            </Text>
            {r.weeks.map((w) =>
              (["job", "drive", "ride"] as const)
                .map((c, i) => (
                  <Text key={`${w.weekStart}${c}`} style={[s.cell, i === 0 ? s.week : {}]}>
                    {w.gusto.entries
                      .filter((e) => e.category === c)
                      .map((e) => h(e.hundredths))
                      .join("\n")}
                  </Text>
                ))
                .concat([
                  <Text key={`${w.weekStart}t`} style={[s.cell, s.bold]}>
                    {h(w.gusto.totalHundredths)}
                  </Text>,
                  <Text key={`${w.weekStart}o`} style={[s.cell, s.bold]}>
                    {h(w.gusto.overtimeHundredths)}
                  </Text>,
                ]),
            )}
            <Text style={s.check}>{r.exempt ? "—" : money(r.weeks.reduce((n, w) => n + (w.gusto.checkGrossCents ?? 0), 0))}</Text>
          </View>
        ))}
        <Text style={s.note}>{labels.note}</Text>
        <View style={s.footer} fixed>
          <Text>{labels.generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPayrollPdf(props: Parameters<typeof PayrollPdf>[0]): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(<PayrollPdf {...props} />);
}
