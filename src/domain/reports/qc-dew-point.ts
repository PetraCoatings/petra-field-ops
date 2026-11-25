/**
 * The QC "Dew point" test: from air temperature, relative humidity and surface
 * temperature (°F), the dew point and how far the surface is above it. The
 * value recorded (and judged against the job's minimum) is that spread in °F.
 * Same formula as the dew point calculator and daily reports.
 */
import { calculateDewPoint, DEW_POINT_FORMULA_VERSION } from "@/domain/calculators/dew-point";

export const DEW_POINT_TEST_CODE = "dew_point";

export type DewPointInputs = { airTempF: number; humidityPct: number; surfaceTempF: number };
export type DewPointReading = { value: number; inputs: DewPointInputs & { dewPointF: number; formula: string } };

export function dewPointReading(i: DewPointInputs): DewPointReading | { error: "humidity" | "temperature" } {
  if (!(i.humidityPct > 0 && i.humidityPct <= 100)) return { error: "humidity" };
  for (const t of [i.airTempF, i.surfaceTempF]) if (!(t >= -40 && t <= 160)) return { error: "temperature" };
  const d = calculateDewPoint({ unit: "F", airTemp: i.airTempF, relativeHumidity: i.humidityPct, substrateTemp: i.surfaceTempF, marginF: 0 });
  return { value: d.spread!, inputs: { ...i, dewPointF: d.dewPoint, formula: DEW_POINT_FORMULA_VERSION } };
}
