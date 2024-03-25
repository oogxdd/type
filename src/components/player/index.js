import ReactPlayer from 'react-player'
import { useState } from 'react'
import { usePlayer } from '@/context'
import { Dropdown, Button } from 'flowbite-react'

const Player = ({ url = 'https://www.youtube.com/watch?v=co_MeKSnyAo' }) => {
  const { playerRef, setSecondsPlayed, playing, setPlaying } = usePlayer()
  const [playbackRate, setPlaybackRate] = useState(1)
  const WIDTH = 400

  const handlePlaybackRateChange = (e) => {
    const rate = parseFloat(e.target.value)
    setPlaybackRate(rate)
    // playerRef.current.seekTo(playerRef.current.getCurrentTime(), 'seconds')
    // playerRef.current.setPlaybackRate(rate)
  }

  const playbackRateOptions = [
    0.5, 1, 1.5, 2, 2.5, 3,
    //
  ]

  return (
    <div className="fixed flex flex-col bottom-8 right-8 rounded-lg">
      <div className="flex self-end flex-wrap mb-1">
        <Dropdown
          label={`${playbackRate}x`}
          dismissOnClick={true}
          placement="left-end"
          renderTrigger={() => (
            <Button color="light">{`${playbackRate}x`}</Button>
          )}
        >
          {playbackRateOptions.map((rate) => (
            <Dropdown.Item
              key={rate}
              onClick={() => {
                setPlaybackRate(rate)
              }}
            >
              {`${rate}x`}
            </Dropdown.Item>
          ))}
        </Dropdown>
      </div>
      <ReactPlayer
        playing={playing}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(true)}
        // onSeek={e => console.log('onSeek', e)}
        ref={playerRef}
        className="react-player"
        url={url}
        controls={true}
        width={WIDTH}
        height={(WIDTH / 16) * 9}
        playbackRate={playbackRate}
        config={{
          youtube: {
            playerVars: {
              start: 0,
              controls: 1,
              color: 'red',
              iv_load_policy: 3,
              playsinline: 1,
            },
          },
        }}
        progressInterval={50}
        // progressInterval={300}
        onProgress={(state) => {
          setSecondsPlayed(state.playedSeconds)
        }}
      />
      {/*
      <div className="bg-white flex flex-col items-center mb-2 overflow-hidden w-full shadow rounded p-2">
        <span className="text-sm font-medium text-gray-700 self-end mr-7">
          Playback rate: {`${playbackRate}x`}
        </span>
        <input
          type="range"
          // className="w-full"
          style={{ width: `calc(100% - 32px)`, marginLeft: -16 }}
          min="0.5"
          max="2"
          step="0.1"
          value={playbackRate}
          onChange={handlePlaybackRateChange}
        />
      </div>
      */}
    </div>
  )
}

export default Player
