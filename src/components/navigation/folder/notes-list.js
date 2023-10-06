import React from "react";

const NoteList = ({ notes, onSelectNote }) => {
  return (
    <div className="h-full overflow-y-auto" style={{ background: "#FFFFFD" }}>
      {notes.map((note) => (
        <div
          key={note.id}
          onClick={() => onSelectNote(note)}
          className="p-2 cursor-pointer hover:bg-gray-200"
        >
          <div className="font-semibold">{note.title}</div>
          <div className="text-sm text-gray-600">{note.body}</div>
          <div className="text-xs text-gray-500">
            {note.modifiedDate.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
};

export default NoteList;
