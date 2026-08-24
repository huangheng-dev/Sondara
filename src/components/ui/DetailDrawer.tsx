import type { ReactNode } from 'react'
import { Drawer, Flex, Space, Typography } from 'antd'

type DetailDrawerProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  width?: number | string
}

export function DetailDrawer({ open, onClose, title, subtitle, children, footer, className, width = 560 }: DetailDrawerProps) {
  return <Drawer
    className={['ui-drawer', className].filter(Boolean).join(' ')}
    open={open}
    size={width}
    onClose={onClose}
    destroyOnHidden
    title={<Space direction="vertical" size={0}><Typography.Text strong>{title}</Typography.Text>{subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}</Space>}
    footer={footer ? <Flex justify="flex-end" wrap gap={8}>{footer}</Flex> : undefined}
  >{children}</Drawer>
}
