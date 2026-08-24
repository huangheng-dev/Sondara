import type { ReactNode } from 'react'
import { Alert, Card, Flex, Skeleton, Space, Typography } from 'antd'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

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
  return <Flex className={['table-toolbar', className].filter(Boolean).join(' ')} vertical gap={12}>
    <Flex align="center" wrap gap={8}>{filters}</Flex>
    {selection}
  </Flex>
}

export function SelectionBar({
  summary,
  actions,
}: {
  summary: ReactNode
  actions: ReactNode
}) {
  return <Card className="selection-bar" size="small">
    <Flex align="center" justify="space-between" wrap gap={8}>
      <Typography.Text>{summary}</Typography.Text>
      <Space wrap>{actions}</Space>
    </Flex>
  </Card>
}

export function PageState({
  status,
  title,
  description,
  onRetry,
}: {
  status: 'loading' | 'error' | 'empty'
  title: string
  description?: string
  onRetry?: () => void
}) {
  if (status === 'loading') {
    return <Card role="status" aria-live="polite">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Flex align="center" gap={10}><RefreshCw/><Typography.Text strong>{title}</Typography.Text></Flex>
      <Skeleton active paragraph={{ rows: 3 }} title={false}/>
      </Space>
    </Card>
  }
  if (status === 'error') {
    return <Alert
      type="error"
      showIcon
      icon={<AlertTriangle/>}
      message={title}
      description={description}
      action={onRetry && <Button onClick={onRetry}>重新加载</Button>}
    />
  }
  return <EmptyState title={title} description={description}/>
}
