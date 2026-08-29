import type { ReactNode } from 'react'
import { Card, Flex, Typography } from 'antd'
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from 'lucide-react'

type StatusNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const defaultIcons = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: CircleAlert,
} as const

export function StatusNotice({
  title,
  description,
  tone = 'neutral',
  icon,
  action,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  tone?: StatusNoticeTone
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const DefaultIcon = defaultIcons[tone]
  return <Card size="small" className={['ui-status-notice', `ui-status-notice--${tone}`, className].filter(Boolean).join(' ')}>
    <Flex className="ui-status-notice__layout" align="center" gap={12}>
      <span className="ui-status-notice__icon" aria-hidden="true">{icon ?? <DefaultIcon size={17}/>}</span>
      <Flex className="ui-status-notice__copy" vertical gap={2}>
        <Typography.Text className="ui-status-notice__title">{title}</Typography.Text>
        {description ? <div className="ui-status-notice__description">{description}</div> : null}
      </Flex>
      {action ? <div className="ui-status-notice__action">{action}</div> : null}
    </Flex>
  </Card>
}
