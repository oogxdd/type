import dynamic from 'next/dynamic'

const TextEditor = dynamic(() => import('@/components/editor/index.js'), {
  ssr: false,
})

const VideoPlayer = dynamic(() => import('@/components/player/index.js'), {
  ssr: false,
})

const TextEditorPage = () => {
  return (
    <div className="flex flex-col gap-y-5">
      <VideoPlayer />
      <TextEditor />
    </div>
  )
}

export default TextEditorPage
