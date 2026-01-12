export type NoteEntry = {
  name: string;
  path: string;
};

export type FolderNode = {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteEntry[];
};

export type NoteMeta = {
  created_ms: number | null;
  updated_ms: number | null;
};

export type DragData = {
  type: "folder" | "note";
  path: string;
};

 
