import { useEffect, useRef, type Key, type ReactNode } from 'react'
import { Flex, Skeleton, Space, Table, type TableColumnsType } from 'antd'
import { EmptyState } from './EmptyState'

export type DataTableColumnKind = 'select' | 'primary' | 'summary' | 'status' | 'metric' | 'time' | 'actions'

type DataTableColumn = {
  key: string
  title: ReactNode
  kind?: DataTableColumnKind
  width?: number | string
  align?: 'left' | 'center' | 'right'
  responsive?: Array<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'>
  ellipsis?: boolean
  fixed?: 'left' | 'right'
}

const inferredKind = (column: DataTableColumn): DataTableColumnKind | undefined => {
  if (column.kind) return column.kind
  if (column.key === 'select') return 'select'
  const textTitle = typeof column.title === 'string' ? column.title : ''
  if (/^(actions|operation|details?)$/i.test(column.key)) return 'actions'
  if (column.key === 'action' && /^(操作|查看|详情|配置入口)$/.test(textTitle)) return 'actions'
  if (/(updated|created|joined|activity|received|synced|tested|time|date)$/i.test(column.key)) return 'time'
  if (/(status|state|stage)$/i.test(column.key)) return 'status'
  if (/(score|quality|progress|rate|metric|value|usage|scale|reach|revenue|deals)$/i.test(column.key)) return 'metric'
  if (/(message|description|summary|note|reason|request|provider|automation|result|next|bottleneck|signal|decision|source|action)$/i.test(column.key)) return 'summary'
  if (/(company|campaign|title|user|service|channel|event|deal|name|buyer|actor|recipient|email|address)$/i.test(column.key)) return 'primary'
  return undefined
}

const widthFor = (column: DataTableColumn) => {
  if (column.width !== undefined) return column.width
  const kind = inferredKind(column)
  if (kind === 'select') return 52
  if (kind === 'actions') return 88
  if (kind === 'primary') return 300
  if (kind === 'summary') return 280
  if (kind === 'time') return 180
  if (kind === 'status') return 140
  if (kind === 'metric') return 160
  return 200
}

export type DataTableRow = {
  key: Key
  cells: ReactNode[]
  className?: string
}

type DataTableProps = {
  ariaLabel?: string
  className?: string
  columns: DataTableColumn[]
  rows: DataTableRow[]
  emptyText?: ReactNode
  loading?: boolean
  skeletonRows?: number
  minWidth?: number
}

const skeletonCell = (kind: DataTableColumnKind | undefined, index: number) => {
  if (kind === 'select') return <Skeleton.Button active size="small" className="data-table__skeleton-check"/>
  if (kind === 'primary') return <Space size={10} style={{ width: '100%' }}><Skeleton.Avatar active size={34}/><Flex vertical gap={6} style={{ flex: 1 }}><Skeleton.Input active size="small" style={{ width: index % 2 ? 128 : 156 }}/><Skeleton.Input active size="small" style={{ width: index % 2 ? 176 : 210 }}/></Flex></Space>
  if (kind === 'summary') return <Flex vertical gap={6} style={{ width: '100%' }}><Skeleton.Input active size="small" style={{ width: '72%' }}/><Skeleton.Input active size="small" style={{ width: '92%' }}/></Flex>
  if (kind === 'status') return <Skeleton.Button active size="small" style={{ width: 72 }}/>
  if (kind === 'actions') return <Space size={6}><Skeleton.Button active size="small"/><Skeleton.Button active size="small"/></Space>
  return <Skeleton.Input active size="small" style={{ width: index % 3 === 0 ? '82%' : index % 3 === 1 ? '64%' : '74%' }}/>
}

export function DataTable({ ariaLabel = '数据表格', className, columns, rows, emptyText, loading, skeletonRows = 6, minWidth = 960 }: DataTableProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hasSelectionColumn = columns.some(column => inferredKind(column) === 'select')
  useEffect(() => {
    const applyTableAccessibility = () => {
      rootRef.current?.querySelectorAll('.ant-table-measure-row').forEach(row => row.setAttribute('inert', ''))
      rootRef.current?.querySelectorAll<HTMLElement>('.ant-table-content').forEach(region => {
        region.tabIndex = 0
        region.setAttribute('role', 'region')
        region.setAttribute('aria-label', `${ariaLabel}，支持横向滚动`)
      })
    }
    applyTableAccessibility()
    const observer = new MutationObserver(applyTableAccessibility)
    if (rootRef.current) observer.observe(rootRef.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ariaLabel, columns, rows])
  const resolvedMinWidth = Math.max(minWidth, columns.reduce((total, column) => {
    const width = widthFor(column)
    return total + (typeof width === 'number' ? width : 190)
  }, 0))
  const antColumns: TableColumnsType<DataTableRow> = columns.map((column, index) => {
    const kind = inferredKind(column)
    return ({
    key: column.key,
    className: kind ? `data-table__cell--${kind}` : undefined,
    title: column.title,
    width: widthFor(column),
    align: column.align ?? (kind === 'select' || kind === 'actions' ? 'center' : undefined),
    responsive: column.responsive,
    ellipsis: column.ellipsis,
    fixed: column.fixed,
    onCell: () => ({ style: { overflow: 'hidden', overflowWrap: 'break-word', wordBreak: 'normal' } }),
    render: (_, row) => row.cells[index],
  })})

  const initialLoading = Boolean(loading) && rows.length === 0
  const displayedRows: DataTableRow[] = initialLoading
    ? Array.from({ length: skeletonRows }, (_, rowIndex) => ({
        key: `skeleton-${rowIndex}`,
        className: 'data-table__skeleton-row',
        cells: columns.map(column => skeletonCell(inferredKind(column), rowIndex)),
      }))
    : rows
  const emptyItemName = ariaLabel.replace(/[，,].*$/, '').replace(/表格$/, '').trim() || '数据'

  return <Flex ref={rootRef} vertical aria-busy={Boolean(loading)} className={['data-table', !hasSelectionColumn ? 'data-table--with-leading-space' : '', initialLoading ? 'data-table--loading' : '', className].filter(Boolean).join(' ')}>
    <Table<DataTableRow>
      columns={antColumns}
      dataSource={displayedRows}
      loading={Boolean(loading) && !initialLoading ? { spinning: true, description: '正在更新…' } : false}
      pagination={false}
      rowClassName={(row) => row.className ?? ''}
      scroll={{ x: resolvedMinWidth }}
      size="middle"
      tableLayout="fixed"
      locale={{ emptyText: emptyText ?? <EmptyState title={`暂无${emptyItemName}`} description={`${emptyItemName}产生后会显示在这里。`}/> }}
    />
  </Flex>
}
