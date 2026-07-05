// DnD identity + edge-snap primitives shared across the tree feature.
// Kept in lib (not the folders-panel component) so hooks and tree-ops can use
// them without depending on a component.
export const DROP_PREFIX = "drop";
export const ROOT_ID = "root";

export const dropId = (id: string, position: "inside") => `${DROP_PREFIX}:${id}:${position}`;

export type EdgeSnap = { id: string; position: "before" | "after" } | null;
