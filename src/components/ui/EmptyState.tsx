import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { Empty } from 'antd'

type EmptyStateProps = {
  title: string
  description?: string
  icon?: ComponentType<LucideProps>
  className?: string
  action?: ReactNode
}

export function EmptyState({ title, description, icon: Icon, className, action }: EmptyStateProps) {
  return <Empty
    className={['app-empty-ant', className].filter(Boolean).join(' ')}
    image={Icon ? <Icon size={30} aria-hidden="true" /> : Empty.PRESENTED_IMAGE_SIMPLE}
    description={<div><strong>{title}</strong>{description && <p className="app-empty-description">{description}</p>}</div>}
  >{action && <div className="app-empty-action">{action}</div>}</Empty>
}
