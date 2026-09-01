import type { ReactNode } from 'react'
import { Card, Drawer, Flex, Space, Typography } from 'antd'
import { DetailSkeleton } from './LoadingState'

type DetailDrawerProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  width?: number | string
  loading?: boolean
}

export function DetailDrawer({ open, onClose, title, subtitle, children, footer, className, width = 560, loading = false }: DetailDrawerProps) {
  return <Drawer
    className={['ui-drawer', className].filter(Boolean).join(' ')}
    open={open}
    size={width}
    onClose={onClose}
    destroyOnHidden
    title={<Space orientation="vertical" size={2} style={{ minWidth: 0 }}><Typography.Text strong>{title}</Typography.Text>{subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}</Space>}
    footer={footer ? <Flex justify="flex-end" wrap gap={8}>{footer}</Flex> : undefined}
  >{loading ? <DetailSkeleton/> : children}</Drawer>
}

type DetailSectionProps = {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  extra?: ReactNode
  className?: string
}

export function DetailSection({ title, subtitle, children, extra, className }: DetailSectionProps) {
  return <Card
    className={['ui-detail-section', className].filter(Boolean).join(' ')}
    size="small"
    title={<Space orientation="vertical" size={0} style={{ minWidth: 0 }}>
      <Typography.Text strong>{title}</Typography.Text>
      {subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : null}
    </Space>}
    extra={extra}
  >
    {children}
  </Card>
}
