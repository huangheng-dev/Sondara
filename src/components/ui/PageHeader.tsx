import type { ReactNode } from 'react'
import { Flex, Space, Typography } from 'antd'

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <Flex className="page-header" component="header" align="flex-start" justify="space-between" wrap gap={16}>
    <Space className="page-header__copy" orientation="vertical" size={4}>
      <Typography.Title level={1}>{title}</Typography.Title>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </Space>
    {actions && <Space className="page-header__actions" wrap>{actions}</Space>}
  </Flex>
}
