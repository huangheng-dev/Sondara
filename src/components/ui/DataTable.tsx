import type { Key, ReactNode } from 'react'
import { Empty, Flex, Table, type TableColumnsType } from 'antd'

type DataTableColumn = {
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
    onCell: () => ({ style: { overflow: 'hidden', overflowWrap: 'anywhere' } }),
    render: (_, row) => row.cells[index],
  }))

  return <Flex vertical className={['data-table', className].filter(Boolean).join(' ')} style={{ overflowX: 'auto' }}>
    <Flex vertical style={{ minWidth }}>
      <Table<DataTableRow>
        bordered
        columns={antColumns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        rowClassName={(row) => row.className ?? ''}
        size="middle"
        tableLayout="fixed"
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据"/> }}
      />
    </Flex>
  </Flex>
}
