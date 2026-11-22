/** Approved products for pickers (work order editor, calculators), with what they can fill in. */
export type PickerProduct = {
  id: string;
  name: string;
  manufacturer: string | null;
  mixRatioA: number | null;
  mixRatioB: number | null;
  mixRatioText: string | null;
  ratioBasis: "volume" | "weight" | null;
  kitSizeGal: number | null;
  coverage: number | null;
  volumeSolids: number | null;
  wftMils: number | null;
  dftMils: number | null;
  dewPointMarginF: number | null;
  /** Current data sheet versions (work order pinning). */
  tdsVersionId: string | null;
  sdsVersionId: string | null;
};
