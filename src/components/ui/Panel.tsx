import type { ReactNode } from 'react'
import { Card, Space, Typography } from 'antd'

export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card
    className={['ui-panel', className].filter(Boolean).join(' ')}
    title={title ? <Space direction="vertical" size={0}><Typography.Text strong>{title}</Typography.Text>{subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}</Space> : undefined}
    extra={action}
    variant="outlined"
  >{children}</Card>
}
