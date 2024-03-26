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

const Comp = (props) => {
  return (
    <NodeViewWrapper className="inline">
      <NodeViewContent className="inline" />
    </NodeViewWrapper>
  )
}

export default Comp
