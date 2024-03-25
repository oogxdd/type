import { createContext, useState, useEffect, useContext, useRef } from 'react'

const PlayerContext = createContext()

const PlayerProvider = ({ children }) => {
  const playerRef = useRef()
  const [secondsPlayed, setSecondsPlayed] = useState(0)
  const [playing, setPlaying] = useState(false)

  return (
    <PlayerContext.Provider
      value={{
        playerRef,

        playing,
        setPlaying,

        secondsPlayed,
        setSecondsPlayed,
      }}
    >
      {children}
    </PlayerContext.Provider>
  )
}

const usePlayer = () => useContext(PlayerContext)

export { PlayerProvider, PlayerContext, usePlayer }
