import type { ReactNode } from 'react'
import { Tag, Tooltip } from 'antd'

export function Badge({ children, tone = 'neutral', truncate = false, tooltip }: { children: ReactNode; tone?: 'green' | 'blue' | 'orange' | 'red' | 'neutral'; truncate?: boolean; tooltip?: ReactNode }) {
  const palette = {
    green: { color: '#135200', background: '#f6ffed', borderColor: '#b7eb8f' },
    blue: { color: '#003a8c', background: '#e6f4ff', borderColor: '#91caff' },
    orange: { color: '#873800', background: '#fff7e6', borderColor: '#ffd591' },
    red: { color: '#820014', background: '#fff1f0', borderColor: '#ffa39e' },
    neutral: undefined,
  } as const
  const badge = <Tag className={`ui-badge ui-badge--${tone}${truncate ? ' ui-badge--truncate' : ''}`} style={palette[tone]}>{truncate ? <span className="ui-badge__text">{children}</span> : children}</Tag>
  return truncate ? <Tooltip title={tooltip ?? children}>{badge}</Tooltip> : badge
}
