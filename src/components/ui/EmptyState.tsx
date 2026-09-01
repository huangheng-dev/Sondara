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
  const resolvedDescription = description ?? (
    isError
      ? '请稍后重试或检查连接状态。'
      : /选择|选中/.test(title)
        ? '完成选择后，这里会显示对应信息。'
        : '相关内容产生后会显示在这里。'
  )
  const content = <Empty
    className={['ui-empty-state', className].filter(Boolean).join(' ')}
    image={isError && Icon ? <span className="ui-empty-state__error-icon"><Icon size={30} aria-hidden="true"/></span> : Empty.PRESENTED_IMAGE_SIMPLE}
    description={<Space orientation="vertical" size={2}><Typography.Text>{title}</Typography.Text><Typography.Text type="secondary">{resolvedDescription}</Typography.Text></Space>}
  >{action}</Empty>
  return content
}
