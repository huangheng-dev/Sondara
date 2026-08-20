import type { Metric } from '@/types'

export function MetricCard({ metric }: { metric: Metric }) {
  return <div className="metric-card"><span>{metric.label}</span><strong>{metric.value}</strong><small className={`metric-${metric.tone ?? 'green'}`}>{metric.change}</small></div>
}
