import React from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { msToTime, getInitials } from '@/helpers'
import {
  PlayIcon as HeroPlayIcon,
  EllipsisHorizontalIcon as HeroMoreIcon,
} from '@heroicons/react/24/outline'
// import {
//   PlayIcon as PlayIconSolid,
// } from '@heroicons/react/24/outline'

const SpeakerComponent = (props) => {
  return (
    <NodeViewWrapper className="flex flex-col">
      <SpeakerLabel {...props} />
    </NodeViewWrapper>
  )
}

const SpeakerLabel = (props) => (
  <div className="flex items-center w-full justify-between mb-2">
    <div className="flex items-center">
      <Avatar {...props} />
      <Name {...props} />
      <div
        className="flex items-center cursor-pointer group"
        onClick={() => {
          console.log('sick')
          props.extension.options.seekTo(props.node.attrs.start / 1000)
        }}
      >
        <PlayIcon />
        <Timespan time={msToTime(props.node.attrs.start)} />
      </div>
    </div>
    {/*
    <ActionsIcon />
    */}
  </div>
)

const Avatar = (props) => (
  <div className="w-6 h-6 bg-gray-300 rounded-full mr-2 flex items-center justify-center text-gray-500 text-xs font-medium">
    {getInitials(props.node.attrs.speaker)}
  </div>
)
const Name = () => (
  <span className="flex font-medium text-gray-900 text-sm mr-4">
    {/* props.node.attrs.speaker */}
    <NodeViewContent />
  </span>
)
const PlayIcon = () => (
  <HeroPlayIcon className="w-4 h-4 mr-1 stroke-2 text-gray-500 group-hover:text-cyan-500" />
)
const Timespan = ({ time }) => (
  <span className="text-xs text-gray-500 _group-hover:text-cyan-600">
    {time}
  </span>
)

// 0:07
const ActionsIcon = () => (
  <HeroMoreIcon className="w-5 h-5 mr-1 stroke-2 text-gray-500" />
)

export default SpeakerComponent
