import type { ReactNode } from 'react'
import { Drawer } from 'antd'

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
    className={`app-detail-drawer ${className ?? ''}`}
    open={open}
    size={width}
    onClose={onClose}
    destroyOnHidden
    title={<span className="detail-drawer-title"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>}
    footer={footer}
  >{children}</Drawer>
}
