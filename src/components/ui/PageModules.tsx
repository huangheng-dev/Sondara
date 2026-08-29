import type { ReactNode } from 'react'
import { Alert, Flex, Space, Typography } from 'antd'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { ContentSkeleton, PageLoading } from './LoadingState'

export function PageContainer({ children }: { children: ReactNode }) {
  return <Flex className="page-container" vertical gap={20}>{children}</Flex>
}

export function TableToolbar({
  filters,
  selection,
  className = '',
}: {
  filters: ReactNode
  selection?: ReactNode
  className?: string
}) {
  return <Flex className={['table-toolbar', className].filter(Boolean).join(' ')} align="center" justify="space-between" wrap gap={12}>
    <Flex className="table-toolbar__filters" align="center" gap={8}>{filters}</Flex>
    {selection}
  </Flex>
}

export function SelectionBar({
  count,
  unit,
  actions,
}: {
  count: number
  unit: string
  actions: ReactNode
}) {
  return <Flex className="selection-bar" align="center" gap={8}>
    <Typography.Text className="selection-bar__summary"><span>已选择</span><strong>{count}</strong><span>{unit}</span></Typography.Text>
    <Space className="selection-bar__actions" size={6}>{actions}</Space>
  </Flex>
}

export function PageState({
  status,
  title,
  description,
  onRetry,
  loadingVariant = 'content',
}: {
  status: 'loading' | 'error' | 'empty'
  title: string
  description?: string
  onRetry?: () => void
  loadingVariant?: 'page' | 'content'
}) {
  if (status === 'loading') {
    return loadingVariant === 'page'
      ? <PageLoading title={title} description={description}/>
      : <ContentSkeleton rows={4}/>
  }
  if (status === 'error') {
    return <Alert
      type="error"
      showIcon
      icon={<AlertTriangle/>}
      title={title}
      description={description}
      action={onRetry && <Button onClick={onRetry}>重新加载</Button>}
    />
  }
  return <EmptyState title={title} description={description}/>
}
