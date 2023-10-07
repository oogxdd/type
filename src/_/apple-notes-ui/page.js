import { useState } from 'react'

import FoldersList from './folders-list'
import NotesList from './notes-list'
import NoteContent from './note-content'
import Toolbar from './toolbar'

function App() {
  const [folders, setFolders] = useState([
    {
      id: 1,
      name: 'Folder 1',
      subfolders: [
        { id: 11, name: 'Subfolder 1.1', subfolders: [] },
        { id: 12, name: 'Subfolder 1.2', subfolders: [] },
      ],
    },
    {
      id: 2,
      name: 'Folder 2',
      subfolders: [
        {
          id: 21,
          name: 'Subfolder 2.1',
          subfolders: [{ id: 211, name: 'Subfolder 2.1.1', subfolders: [] }],
        },
      ],
    },
  ])

  const [notes, setNotes] = useState([
    {
      id: 1,
      title: 'Note 1',
      body: 'This is note 1 content.',
      modifiedDate: '2023-04-25',
    },
    {
      id: 2,
      title: 'Note 2',
      body: 'This is note 2 content.',
      modifiedDate: '2023-04-24',
    },
  ])

  const [selectedNote, setSelectedNote] = useState(null)

  const handleSelectFolder = (folder) => {
    console.log('Selected folder:', folder)
  }

  const handleSelectNote = (note) => {
    setSelectedNote(note)
  }

  const handleSearch = (query) => {
    console.log('Search query:', query)
  }

  return (
    <div className="App h-screen bg-gray-100">
      <Toolbar onSearch={handleSearch} />
      <div className="flex h-full">
        <div className="w-1/4 bg-white border-r">
          <FoldersList folders={folders} onSelectFolder={handleSelectFolder} />
        </div>
        <div className="w-1/4 bg-white border-r">
          <NotesList notes={notes} onSelectNote={handleSelectNote} />
        </div>
        <div className="w-1/2">
          <NoteContent note={selectedNote} />
        </div>
      </div>
    </div>
  )
}

export default App
