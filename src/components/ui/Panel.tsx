import type { ReactNode } from 'react'
import { Card } from 'antd'

export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card
    className={`app-panel panel ${className}`}
    classNames={{ header: 'panel-header', body: 'panel-body' }}
    title={title ? <div>{<h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div> : undefined}
    extra={action}
    variant="outlined"
  >{children}</Card>
}
