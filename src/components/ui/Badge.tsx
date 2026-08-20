import type { ReactNode } from 'react'
import { Tag } from 'antd'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'blue' | 'orange' | 'red' | 'neutral' }) {
  const palette = tone === 'green'
    ? { color: '#067647', backgroundColor: '#ecfdf3' }
    : tone === 'blue'
      ? { color: '#175cd3', backgroundColor: '#eff8ff' }
      : tone === 'orange'
        ? { color: '#93370d', backgroundColor: '#fffaeb' }
        : tone === 'red'
          ? { color: '#b42318', backgroundColor: '#fef3f2' }
          : { color: '#344054', backgroundColor: '#f2f4f7' }
  return <Tag variant="filled" style={{ marginInlineEnd: 0, ...palette }}>{children}</Tag>
}
