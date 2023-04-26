import React, { useState, useEffect } from "react";

const NoteContent = ({ note, onUpdateNote }) => {
  const [noteContent, setNoteContent] = useState(note);

  useEffect(() => {
    setNoteContent(note);
  }, [note]);

  const handleTitleChange = (e) => {
    const updatedNote = { ...noteContent, title: e.target.value };
    setNoteContent(updatedNote);
  };

  const handleBodyChange = (e) => {
    const updatedNote = { ...noteContent, body: e.target.value };
    setNoteContent(updatedNote);
  };

  const handleSave = () => {
    onUpdateNote(noteContent);
  };

  if (!noteContent) {
    return (
      <div className="p-4 text-gray-500">
        Select a note to view its content.
      </div>
    );
  }

  return (
    <div className="p-4">
      <input
        type="text"
        value={noteContent.title}
        onChange={handleTitleChange}
        className="w-full text-2xl font-semibold mb-2 border-none outline-none"
      />
      <textarea
        value={noteContent.body}
        onChange={handleBodyChange}
        className="w-full h-full border-none outline-none resize-none"
      ></textarea>
      <button
        onClick={handleSave}
        className="absolute bottom-4 right-4 px-4 py-2 text-white bg-blue-500 rounded-md"
      >
        Save
      </button>
    </div>
  );
};

export default NoteContent;

// import React from 'react';

// const NoteContent = ({ note }) => {
//   return (
//     <div className="h-full p-4">
//       {note && (
//         <>
//           <h1 className="text-2xl font-semibold mb-2">{note.title}</h1>
//           <p>{note.body}</p>
//           <div className="text-xs text-gray-500 mt-4">{note.modifiedDate}</div>
//         </>
//       )}
//     </div>
//   );
// };

// export default NoteContent;
