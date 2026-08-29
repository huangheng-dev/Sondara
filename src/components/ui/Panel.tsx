import type { ReactNode } from 'react'
import { Card, Typography } from 'antd'

export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card
    className={['ui-panel', subtitle ? 'ui-panel--with-subtitle' : '', className].filter(Boolean).join(' ')}
    title={title ? <div className="ui-panel__heading">
      <Typography.Title level={2} className="ui-panel__title">{title}</Typography.Title>
      {subtitle && <Typography.Text type="secondary" className="ui-panel__subtitle">{subtitle}</Typography.Text>}
    </div> : undefined}
    extra={action}
    variant="outlined"
  >{children}</Card>
}
