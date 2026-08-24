import { Flex, Pagination as AntPagination, Typography } from 'antd'

type PaginationProps = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: number[]
  itemName?: string
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [6, 10, 20], itemName = '条记录' }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = total ? (safePage - 1) * pageSize + 1 : 0
  const end = Math.min(safePage * pageSize, total)
  return <Flex className="ui-pagination" component="nav" aria-label="列表分页" align="center" justify="space-between" wrap gap={16}>
    <Typography.Text type="secondary">第 {start}–{end} 条，共 {total} {itemName}</Typography.Text>
    <AntPagination
      current={safePage}
      pageSize={pageSize}
      total={total}
      pageSizeOptions={pageSizeOptions}
      showSizeChanger
      showQuickJumper
      responsive
      onChange={(nextPage, nextPageSize) => {
        if (nextPageSize !== pageSize) onPageSizeChange(nextPageSize)
        else onPageChange(nextPage)
      }}
    />
  </Flex>
}
