import { get, set, update } from "idb-keyval";

// cons);

export const getFolders = async () => {
  const folders = await get("folders");
  return folders;
};

export const getNotes = async () => {
  const notes = await get("notes");
  return notes;
};

export const setFolders = async (folders) => {
  await set("folders", folders);
};

export const setNotes = async (notes) => {
  await set("notes", notes);
};

export const updateNote = async (updatedNote) => {
  const notes = await get("notes");
  const updatedNotes = notes.map((note) =>
    note.id === updatedNote.id ? updatedNote : note
  );
  await set("notes", updatedNotes);
};

export const sampleFolders = [
  {
    id: 1,
    name: "Folder 1",
    subfolders: [
      { id: 11, name: "Subfolder 1.1", subfolders: [] },
      { id: 12, name: "Subfolder 1.2", subfolders: [] },
    ],
  },
  {
    id: 2,
    name: "Folder 2",
    subfolders: [
      {
        id: 21,
        name: "Subfolder 2.1",
        subfolders: [{ id: 211, name: "Subfolder 2.1.1", subfolders: [] }],
      },
    ],
  },
];

export const sampleNotes = [
  {
    id: 1,
    title: "Note 1",
    body: "This is note 1 content.",
    modifiedDate: "2023-04-25",
  },
  {
    id: 2,
    title: "Note 2",
    body: "This is note 2 content.",
    modifiedDate: "2023-04-24",
  },
];
