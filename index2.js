import { usePlayer } from '@/context'
import { useEffect } from 'react'
import { data } from '@/data'
import dynamic from 'next/dynamic'

const TextEditor = dynamic(() => import('@/components/editor/index.js'), {
  ssr: false,
})

const VideoPlayer = dynamic(() => import('@/components/player/index.js'), {
  ssr: false,
})

const TextEditorPage = () => {
  // const { secondsPlayed } = usePlayer()
  // useEffect(() => {
  //   const msPlayed = secondsPlayed * 1000
  //   const currentUtterance = data.find(
  //     (utterance) => msPlayed >= utterance.start && msPlayed < utterance.end
  //   )
  //   const currentWord =
  //     currentUtterance &&
  //     currentUtterance.find(
  //       (word) => msPlayed >= word.start && msPlayed < word.end
  //     )
  //   const currentWordEl =
  //     currentWord &&
  //     document.getElementById(`word-${currentWord.start}-${currentWord.end}`)

  //   let prevbg
  //   if (currentWordEl) {
  //     console.log('OK')
  //     prevbg = currentWordEl.style.background
  //     // currentWordEl.style.background = '#2563eb'
  //     // currentWordEl.style.background = '#b559a2'
  //     // currentWordEl.style.background = 'rgb(198 177 193)'
  //     // currentWordEl.style.background = 'rgb(240 231 238)'
  //     currentWordEl.style.background = '#65e1ff'
  //     // currentWordEl.style.background = 'rgb(255 221 109)'

  //     // currentWordEl.style.color = 'white'
  //     // currentWordEl.style.color = '#382e2e'
  //     currentWordEl.style.color = 'red'
  //   }

  //   return () => {
  //     if (currentWordEl) {
  //       currentWordEl.style.background = prevbg || 'unset'
  //       currentWordEl.style.color = 'unset'
  //     }
  //   }
  // }, [secondsPlayed])

  return (
    <div className="flex flex-col gap-y-5">
      <VideoPlayer />
      <TextEditor />
    </div>
  )
}

export default TextEditorPage
