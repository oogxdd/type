export type TreeItem = {
  id: string;
  name: string;
  children: TreeItem[];
  collapsed?: boolean;
};

export type FlattenedItem = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  children: TreeItem[];
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
