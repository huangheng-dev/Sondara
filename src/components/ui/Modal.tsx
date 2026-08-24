import type { ReactNode } from 'react'
import { Flex, Modal as AntModal, Space, Typography } from 'antd'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  actions?: ReactNode
  width?: number
}

export function Modal({ open, title, description, children, onClose, footer, actions, width = 560 }: ModalProps) {
  return <AntModal
    className="ui-modal"
    open={open}
    width={width}
    centered
    destroyOnHidden
    onCancel={onClose}
    footer={footer ? <Flex justify="flex-end" wrap gap={8}>{footer}</Flex> : null}
    title={<Flex align="flex-start" justify="space-between" gap={16}><Space direction="vertical" size={0}><Typography.Text strong>{title}</Typography.Text>{description && <Typography.Text type="secondary">{description}</Typography.Text>}</Space>{actions && <Space wrap>{actions}</Space>}</Flex>}
  ><div className="ui-modal__body">{children}</div></AntModal>
}
