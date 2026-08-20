import type { Key, ReactNode } from 'react'
import { Table, type TableColumnsType } from 'antd'

export type DataTableColumn = {
  key: string
  title: ReactNode
  width?: number | string
  align?: 'left' | 'center' | 'right'
}

export type DataTableRow = {
  key: Key
  cells: ReactNode[]
  className?: string
}

type DataTableProps = {
  className?: string
  columns: DataTableColumn[]
  rows: DataTableRow[]
  loading?: boolean
  minWidth?: number
}

export function DataTable({ className, columns, rows, loading, minWidth = 960 }: DataTableProps) {
  const antColumns: TableColumnsType<DataTableRow> = columns.map((column, index) => ({
    key: column.key,
    title: column.title,
    width: column.width,
    align: column.align,
    className: column.key === 'actions' ? 'app-data-table-actions-cell' : undefined,
    render: (_, row) => row.cells[index],
  }))

  return <div className={['app-data-table', className].filter(Boolean).join(' ')}>
    <Table<DataTableRow>
      columns={antColumns}
      dataSource={rows}
      loading={loading}
      pagination={false}
      rowClassName={(row) => row.className ?? ''}
      scroll={{ x: minWidth }}
      size="middle"
      tableLayout="fixed"
    />
  </div>
}
