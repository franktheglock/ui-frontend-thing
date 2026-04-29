import React from 'react'
import { Zap, Clock, Hash } from 'lucide-react'
import { GenerationInfo as GenerationInfoType } from '../stores/chatStore'
import { formatTokensPerSecond, formatDuration } from '../lib/utils'

interface GenerationInfoProps {
  info: GenerationInfoType
}

export function GenerationInfo({ info }: GenerationInfoProps) {
  const tokens = info.tokensUsed || info.completionTokens || 0
  if (tokens === 0) return null

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground py-1">
      <span className="flex items-center gap-1">
        <Hash className="w-3 h-3" />
        {info.tokensUsed || info.completionTokens || 0} tokens
      </span>
      
      {info.tokensPerSecond && (
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {formatTokensPerSecond(info.tokensPerSecond)}
        </span>
      )}
      
      {info.totalDuration && (
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDuration(info.totalDuration / 1e6)}
        </span>
      )}
      
      <span className="text-muted-foreground/50">
        {info.provider} / {info.model}
      </span>
    </div>
  )
}
