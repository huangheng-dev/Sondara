import type { ReactNode } from 'react'
import { Flex, Modal as AntModal, Space, Typography } from 'antd'
import { DetailSkeleton } from './LoadingState'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  descriptionTone?: 'secondary' | 'warning' | 'danger'
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  actions?: ReactNode
  width?: number
  loading?: boolean
}

export function Modal({ open, title, description, descriptionTone = 'secondary', children, onClose, footer, actions, width = 560, loading = false }: ModalProps) {
  return <AntModal
    className="ui-modal"
    open={open}
    width={width}
    centered
    destroyOnHidden
    onCancel={onClose}
    footer={footer ? <Flex justify="flex-end" wrap gap={8}>{footer}</Flex> : null}
    title={<Flex align="flex-start" justify="space-between" gap={16}><Space orientation="vertical" size={4} style={{ minWidth: 0, flex: 1 }}><Typography.Text strong>{title}</Typography.Text>{description && <Typography.Text type={descriptionTone}>{description}</Typography.Text>}</Space>{actions && <Space wrap>{actions}</Space>}</Flex>}
  ><div className="ui-modal__body">{loading ? <DetailSkeleton/> : children}</div></AntModal>
}
