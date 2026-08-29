import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { Empty, Space, Typography } from 'antd'
import { ContentSkeleton } from './LoadingState'

type EmptyStateProps = {
  title: string
  description?: string
  icon?: ComponentType<LucideProps>
  className?: string
  action?: ReactNode
  spinning?: boolean
}

export function EmptyState({ title, description, icon: Icon, className, action, spinning }: EmptyStateProps) {
  if (spinning) return <ContentSkeleton card={false} rows={4}/>
  const isError = /失败|错误/.test(title)
  const content = <Empty
    className={['ui-empty-state', className].filter(Boolean).join(' ')}
    image={isError && Icon ? <span className="ui-empty-state__error-icon"><Icon size={30} aria-hidden="true"/></span> : Empty.PRESENTED_IMAGE_SIMPLE}
    description={<Space orientation="vertical" size={2}><Typography.Text>{title}</Typography.Text>{description && <Typography.Text type="secondary">{description}</Typography.Text>}</Space>}
  >{action}</Empty>
  return content
}
