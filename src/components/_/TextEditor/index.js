import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { get, set, update } from "idb-keyval";

import {
  getFolders,
  getNotes,
  updateNote,
  //
  sampleFolders,
  sampleNotes,
} from "@/db";

import FoldersList from "@/components/FoldersList";
import NotesList from "@/components/NotesList";
import NoteContent from "@/components/NoteContent";
import SearchBar from "@/components/Toolbar";

// import db from "@/db";

function App() {
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);

  useEffect(() => {
    (async () => {
      const folderData = await getFolders();
      const noteData = await getNotes();
      setFolders(folderData || sampleFolders);
      setNotes(noteData || sampleNotes);
    })();
  }, []);

  const handleSelectFolder = async (folder) => {
    console.log(folder);
    console.log("select");
    setSelectedFolder(folder);
    const folderNotes = notes.filter((note) => note.folderId === folder.id);
    console.log(folderNotes);
    setNotes(folderNotes);
    if (folderNotes.length > 0) {
      setSelectedNote(folderNotes[0]);
    } else {
      setSelectedNote(null);
    }
  };

  console.log(notes);

  const handleSelectNote = (note) => {
    setSelectedNote(note);
  };

  const createNewNote = async () => {
    const newNote = {
      id: Date.now(),
      folderId: selectedFolder.id,
      title: "",
      content: "",
      modifiedDate: new Date(),
    };

    await addNote(newNote);
    const folderNotes = await getNotesInFolder(selectedFolder.id);
    setNotes(folderNotes);
    setSelectedNote(newNote);
  };

  const getNotesInFolder = async (folderId) => {
    const allNotes = await get("notes");
    return allNotes.filter((note) => note.folderId === folderId);
  };

  const addNote = async (note) => {
    const allNotes = await get("notes");
    allNotes.push(note);
    await set("notes", allNotes);
  };

  const handleSearch = (query) => {
    console.log("Search query:", query);
  };

  const handleNoteUpdate = async (updatedNote) => {
    await updateNote(updatedNote);
    const noteData = await getNotes();
    setNotes(noteData);
  };

  return (
    <div className="h-screen">
      {/*
       */}
      <SearchBar onSearch={handleSearch} />
      <div className="flex h-full">
        <div
          className="w-1/4 border-r"
          style={{
            borderColor: "#D5D5D4",
          }}
        >
          <FoldersList folders={folders} onSelectFolder={handleSelectFolder} />
        </div>
        <div
          className="w-1/4 border-r"
          style={{
            borderColor: "#D5D5D5",
          }}
        >
          <NotesList notes={notes} onSelectNote={handleSelectNote} />
        </div>
        <div className="w-1/2">
          <NoteContent
            note={selectedNote}
            onUpdateNote={handleNoteUpdate}
            onCreateNewNote={createNewNote}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
