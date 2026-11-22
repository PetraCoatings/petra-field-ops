/** The project details frozen into a published revision (see publish_fwo()). */
export type ProjectSnapshot = {
  name?: string | null;
  jobNumber?: string | null;
  customer?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  scheduledStart?: string | null;
  totalSqft?: string | number | null;
  flooringSystem?: string | null;
  projectManager?: string | null;
  crewLead?: string | null;
  contacts?: { name: string; title: string | null; phone: string | null }[];
};

export function snapshotAddress(s: ProjectSnapshot): string {
  const cityLine = [s.city, [s.state, s.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [s.street, cityLine].filter(Boolean).join(", ");
}
