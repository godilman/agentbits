import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Agent } from '@shared/types'
import { avatarRects } from '@/features/office/sprites'
import { STATUS_META, cn } from '@/lib/format'

interface Props {
  agent?: Pick<Agent, 'hair' | 'skin' | 'color' | 'status' | 'name'> | null
  size?: number
  showStatus?: boolean
  className?: string
}

/** Crisp pixel-art avatar drawn from the same sprite data as the office. */
export const PixelAvatar = memo(function PixelAvatar({ agent, size = 24, showStatus = false, className }: Props) {
  const { t } = useTranslation()
  if (!agent) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-md border border-dashed border-zinc-700 text-[10px] text-zinc-400', className)}
        style={{ width: size, height: size }}
        title={t('layout:avatar.unassigned')}
      >
        ?
      </div>
    )
  }
  const rects = avatarRects({ hair: agent.hair, skin: agent.skin, shirt: agent.color })
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} title={agent.name}>
      <div
        className="h-full w-full overflow-hidden rounded-md ring-1 ring-white/10"
        style={{ background: `linear-gradient(160deg, ${agent.color}33, #18181b 70%)` }}
      >
        <svg viewBox="-1 0 14 12" width={size} height={size} shapeRendering="crispEdges">
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.fill} />
          ))}
        </svg>
      </div>
      {showStatus && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface',
            STATUS_META[agent.status].dot,
            agent.status === 'working' && 'animate-pulse'
          )}
        />
      )}
    </div>
  )
})
