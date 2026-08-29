import { Space, Typography } from 'antd'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const compactFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export const formatCompactTime = (value: number | null | undefined) => value ? compactFormatter.format(value) : '暂无记录'

export function RecordTime({ value, label = '最近更新' }: { value: number | null | undefined; label?: string }) {
  return <Space orientation="vertical" size={0}>
    <Typography.Text>{value ? dateFormatter.format(value) : '暂无记录'}</Typography.Text>
    <Typography.Text type="secondary">{label}</Typography.Text>
  </Space>
}
