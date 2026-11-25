import { describe, expect, it } from "vitest";
import { dewPointReading } from "./qc-dew-point";

describe("QC dew point test", () => {
  it("records how far the surface is above the dew point (same numbers as the daily report)", () => {
    // 70 °F air at 50 % RH: dew point 50.5 °F; a 57 °F surface is 6.5 °F above it.
    expect(dewPointReading({ airTempF: 70, humidityPct: 50, surfaceTempF: 57 })).toEqual({
      value: 6.5,
      inputs: { airTempF: 70, humidityPct: 50, surfaceTempF: 57, dewPointF: 50.5, formula: "magnus-alduchov-eskridge-1996" },
    });
    // A surface below the dew point is negative (condensation).
    expect((dewPointReading({ airTempF: 70, humidityPct: 90, surfaceTempF: 60 }) as { value: number }).value).toBeLessThan(0);
  });

  it("refuses readings that can't be right", () => {
    expect(dewPointReading({ airTempF: 70, humidityPct: 0, surfaceTempF: 60 })).toEqual({ error: "humidity" });
    expect(dewPointReading({ airTempF: 70, humidityPct: 120, surfaceTempF: 60 })).toEqual({ error: "humidity" });
    expect(dewPointReading({ airTempF: 700, humidityPct: 50, surfaceTempF: 60 })).toEqual({ error: "temperature" });
  });
});
