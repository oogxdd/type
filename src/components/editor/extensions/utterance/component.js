import React from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import {
  PlayIcon as HeroPlayIcon,
  EllipsisHorizontalIcon as HeroMoreIcon,
} from '@heroicons/react/24/outline'

const UtteranceComponent = (props) => {
  const increase = () => {
    props.updateAttributes({
      count: props.node.attrs.count + 1,
    })
  }

  console.log(props)

  return (
    <NodeViewWrapper className="flex flex-col mb-6" contentEditable={true}>
      <SpeakerLabel />
      {/*
       */}
      <NodeViewContent />
    </NodeViewWrapper>
  )
}

const SpeakerLabel = () => (
  <div className="flex items-center w-full justify-between mb-2">
    <div className="flex items-center">
      <Avatar />
      <Name />
      <PlayIcon />
      <Timespan />
    </div>
    <ActionsIcon />
  </div>
)

const Avatar = () => (
  <div className="w-6 h-6 bg-gray-300 rounded-full mr-2 flex items-center justify-center text-gray-500 text-sm font-medium">
    J
  </div>
)
const Name = () => (
  <node-view>
    <span
      className="font-medium text-gray-900 text-sm mr-4"
      contentEditable={true}
    >
      John Lee
    </span>
  </node-view>
)
const PlayIcon = () => (
  <HeroPlayIcon className="w-4 h-4 mr-1 stroke-2 text-gray-500" />
)
const Timespan = () => <span className="text-xs text-gray-500">0:07</span>
const ActionsIcon = () => (
  <HeroMoreIcon className="w-5 h-5 mr-1 stroke-2 text-gray-500" />
)

export default UtteranceComponent
