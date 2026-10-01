/**
 * Shapes for the Understand tool: markdown knowledge gathered from a few
 * curated roots under internal-repos, plus the progress you record against it.
 */

export type CollectionKind = "curriculum" | "runbooks" | "reference" | "claude";

export type CollectionMeta = {
  id: string;
  name: string;
  description: string;
  kind: CollectionKind;
  /** Icon name resolved client-side; keeps this module free of React imports. */
  icon: string;
};

/** One `- [ ]` line in a module, with the study hints attached beneath it. */
export type Topic = {
  /** Position among the checkboxes in the file — the handle used to tick it. */
  index: number;
  title: string;
  description: string;
  done: boolean;
  /** Audit items this topic explains, e.g. ["AWS-01", "K8S-05"]. */
  audit: string[];
  ask: string | null;
  see: string | null;
  /** The written lesson for this topic, if one has been generated. */
  lesson: string | null;
  /** Your own explanation, from notes/<module>.md under this topic's heading. */
  note: string | null;
  /** Repo-relative path the lesson is stored at. */
  lessonId: string;
};

export type DocSummary = {
  /** Path relative to the repo root — stable id and URL slug. */
  id: string;
  collection: string;
  /** The collection's kind. UI should branch on this, never on a track id. */
  collectionKind: CollectionKind;
  title: string;
  /** The module's `**Goal:**` line, or the first paragraph. */
  summary: string;
  /** Leading number in a curriculum filename, for ordering. */
  moduleNumber: string | null;
  prerequisites: string[];
  timeEstimate: string | null;
  headings: string[];
  audit: string[];
  topicCount: number;
  topicsDone: number;
  /** Topics that already have a written lesson. */
  lessonsWritten: number;
  wordCount: number;
  readingMinutes: number;
  modifiedAt: string;
  /** True once you've marked it seen and understood. */
  archived: boolean;
  archivedAt: string | null;
  archiveNote: string | null;
  /** Set for curriculum modules that have a file in notes/. */
  hasNote: boolean;
  noteWords: number;
  searchText: string;
};

export type DocDetail = {
  summary: DocSummary;
  markdown: string;
  topics: Topic[];
  note: string | null;
  /** Other docs sharing an audit item with this one. */
  related: { id: string; title: string; collection: string }[];
};

/** A claude.ai artifact registered by link rather than stored as a file. */
export type ArtifactLink = {
  id: string;
  title: string;
  url: string;
  description: string;
  addedAt: string;
  archived?: boolean;
};

export type UnderstandState = {
  archived: Record<string, { at: string; note: string | null }>;
  artifacts: ArtifactLink[];
};
