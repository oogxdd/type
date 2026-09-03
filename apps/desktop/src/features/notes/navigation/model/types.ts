// Shared node shapes for the notes navigation surface.
// Folder trees and feed buckets both fit this contract.
import type { NoteEntry } from "@typenotes/shared/types";

export type NavigationNode = {
  id: string;
  name: string;
  secondaryName?: string | null;
  children: NavigationNode[];
  noteCount?: number;
  notes?: NoteEntry[];
};

export type TreeItem = {
  id: string;
  name: string;
  children: TreeItem[];
  noteCount?: number;
  notes?: NoteEntry[];
  collapsed?: boolean;
};

export type FlattenedItem = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  children: TreeItem[];
  noteCount?: number;
  notes?: NoteEntry[];
  collapsed?: boolean;
};

export type Projection = {
  depth: number;
  parentId: string | null;
};

export type SensorContext = {
  items: FlattenedItem[];
  offset: number;
};
