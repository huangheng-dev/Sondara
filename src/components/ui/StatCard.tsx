import { Card, Statistic } from 'antd'
import type { ReactNode } from 'react'

interface StatCardProps {
  title: string
  value: number | string
  icon?: ReactNode
  color?: string
  suffix?: string
  prefix?: ReactNode
}

export function StatCard({ title, value, icon, color = '#1677ff', suffix, prefix }: StatCardProps) {
  return (
    <Card>
      <Statistic
        title={title}
        value={value}
        suffix={suffix}
        prefix={prefix || (icon && <span style={{ color }}>{icon}</span>)}
      />
    </Card>
  )
}
