import React, { useState, useEffect } from "react";

function NoteContent({ note, onUpdateNote, onCreateNewNote }) {
  const [content, setContent] = useState(note ? note.content : "");

  useEffect(() => {
    setContent(note ? note.content : "");
  }, [note]);

  const handleChange = (e) => {
    setContent(e.target.value);
  };

  const handleBlur = () => {
    if (note) {
      onUpdateNote({
        ...note,
        content,
        modifiedDate: new Date(),
      });
    }
  };

  const handleClick = () => {
    if (!note && onCreateNewNote) {
      onCreateNewNote();
    }
  };

  return (
    <div
      className="p-6 w-full h-full flex flex-col"
      style={{ background: "#FFFFFD" }}
    >
      {note && (
        <>
          <input
            type="text"
            value={note.title}
            onChange={(e) =>
              onUpdateNote({
                ...note,
                title: e.target.value,
                modifiedDate: new Date(),
              })
            }
            className="text-2xl font-semibold mb-4 border-none outline-none focus:ring-0"
            placeholder="New Note"
          />
          <textarea
            value={content}
            onChange={handleChange}
            onBlur={handleBlur}
            className="resize-none flex-1 outline-none border-none focus:ring-0"
            placeholder="Type here..."
          />
        </>
      )}
      {!note && (
        <div
          className="w-full h-full flex items-center justify-center"
          onClick={handleClick}
        >
          <p className="text-gray-500">Click here to create a new note</p>
        </div>
      )}
    </div>
  );
}

export default NoteContent;
