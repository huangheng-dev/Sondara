import type { ReactNode } from 'react'
import { Modal as AntModal } from 'antd'

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
    className="app-modal"
    open={open}
    width={width}
    centered
    destroyOnHidden
    onCancel={onClose}
    footer={footer ?? null}
    title={<div className="app-modal-title"><span><strong>{title}</strong>{description && <small>{description}</small>}</span>{actions && <div className="app-modal-title-actions">{actions}</div>}</div>}
  >{children}</AntModal>
}
