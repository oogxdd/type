import { useEffect, useState } from 'react'
import { CONTENT_PRE_KEY } from '@/constants'

const NotesListPage = ({ setContentKey }) => {
  const [notes, setNotes] = useState([])
  const [focusedNote, setFocusedNote] = useState(null)

  useEffect(() => {
    fetchNotes()
  }, [])

  const fetchNotes = () => {
    let keys = Object.keys(window.localStorage).filter(
      (key) => key.startsWith(CONTENT_PRE_KEY) && key !== 'contentKey'
    )
    console.log(keys)

    let notesWithContent = keys.map((key) => {
      return {
        id: key,
        content: window.localStorage.getItem(key),
      }
    })

    console.log(notesWithContent)
    setNotes(notesWithContent)
  }

  const handleSelect = (index) => {
    let selectedNote = notes[index].id
    setContentKey(selectedNote)
  }

  return (
    <div>
      {notes.map((note, i) => (
        <div
          style={i === focusedNote ? { backgroundColor: 'lightgrey' } : {}}
          key={note.id}
          onClick={() => handleSelect(i)}
        >
          {note.content.substr(0, 60)}
        </div>
      ))}
    </div>
  )
}

export default NotesListPage
