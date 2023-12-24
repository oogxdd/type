import { useEffect, useState } from 'react'
import { CONTENT_PRE_KEY } from '@/constants'

const NotesListPage = ({ setContentKey }) => {
  const [notes, setNotes] = useState([])
  const [focusedNote, setFocusedNote] = useState(null)

  useEffect(() => {
    fetchNotes()
  }, [])

  const fetchNotes = () => {
    //... Fetching Code: read from localStorage
    let keys = Object.keys(window.localStorage).filter(
      (key) => key.startsWith(CONTENT_PRE_KEY) && key !== 'contentKey'
    )
    setNotes(keys)
  }

  const handleSelect = (index) => {
    let selectedNote = notes[index]
    setContentKey(selectedNote)
  }

  return (
    <div>
      {notes.map((key, i) => (
        <div
          style={i === focusedNote ? { backgroundColor: 'lightgrey' } : {}}
          key={i}
          onClick={() => handleSelect(i)}
        >
          {key}
        </div>
      ))}
    </div>
  )
}

export default NotesListPage
