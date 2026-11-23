/** Photo stages and jobsite issue kinds (kept in step with the database checks). */
export const PHOTO_STAGES = ["before", "surface_prep", "repairs", "primer", "body_coat", "broadcast", "topcoat", "finished", "issue", "other"] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];
export const ISSUE_TYPES = ["concrete", "moisture", "equipment", "product", "delay", "extra_work", "safety", "other"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
