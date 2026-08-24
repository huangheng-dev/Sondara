import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { Empty, Space, Spin, Typography } from 'antd'

type EmptyStateProps = {
  title: string
  description?: string
  icon?: ComponentType<LucideProps>
  className?: string
  action?: ReactNode
  spinning?: boolean
}

export function EmptyState({ title, description, icon: Icon, className, action, spinning }: EmptyStateProps) {
  return <Empty
    className={['ui-empty-state', className].filter(Boolean).join(' ')}
    image={Icon ? <Spin spinning={Boolean(spinning)} indicator={<Icon size={30} aria-hidden="true"/>}><span/></Spin> : Empty.PRESENTED_IMAGE_SIMPLE}
    description={<Space direction="vertical" size={2}><Typography.Text strong>{title}</Typography.Text>{description && <Typography.Text type="secondary">{description}</Typography.Text>}</Space>}
  >{action}</Empty>
}
