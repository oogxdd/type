import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const db = dynamic(() => import("@/db"), {
  ssr: false,
});

import FoldersList from "@/components/FoldersList";
import NotesList from "@/components/NotesList";
import NoteContent from "@/components/NoteContent";
import SearchBar from "@/components/Toolbar";

// import db from "@/db";

function App() {
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);

  useEffect(() => {
    console.log("go");
    console.log(db);
    if (db) {
      const folderData = db.get("folders").value();
      console.log(folderData);
      const noteData = db.get("notes").value();
      setFolders(folderData);
      setNotes(noteData);
    }
  }, [db]);

  const handleSelectFolder = (folder) => {
    console.log("Selected folder:", folder);
  };

  const handleSelectNote = (note) => {
    setSelectedNote(note);
  };

  const handleSearch = (query) => {
    console.log("Search query:", query);
  };

  const handleNoteUpdate = (updatedNote) => {
    db.get("notes").find({ id: updatedNote.id }).assign(updatedNote).write();
    const noteData = db.get("notes").value();
    setNotes(noteData);
  };

  return <div>yo man</div>;

  return (
    <div className="h-screen bg-gray-100">
      <SearchBar onSearch={handleSearch} />
      <div className="flex h-full">
        <div className="w-1/4 bg-white border-r">
          <FoldersList folders={folders} onSelectFolder={handleSelectFolder} />
        </div>
        <div className="w-1/4 bg-white border-r">
          <NotesList notes={notes} onSelectNote={handleSelectNote} />
        </div>
        <div className="w-1/2">
          <NoteContent note={selectedNote} onUpdateNote={handleNoteUpdate} />
        </div>
      </div>
    </div>
  );
}

export default App;
