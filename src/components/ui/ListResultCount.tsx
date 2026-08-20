type ListResultCountProps = {
  visible: number
  total: number
  unit: string
}

export function ListResultCount({ visible, total, unit }: ListResultCountProps) {
  return <span className="module-result-count" aria-live="polite" aria-label={`当前显示 ${visible}，全部 ${total} ${unit}`}>
    <strong>{visible}</strong>
    <span>/ {total} {unit}</span>
  </span>
}
