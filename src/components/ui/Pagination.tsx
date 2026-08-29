import { Flex, Pagination as AntPagination, Typography } from 'antd'
import { PAGE_SIZE_OPTIONS } from '@/lib/pagination'

type PaginationProps = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  itemName?: string
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, itemName = '条记录' }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = total ? (safePage - 1) * pageSize + 1 : 0
  const end = Math.min(safePage * pageSize, total)
  return <Flex className="ui-pagination" component="nav" aria-label="列表分页" align="center" justify="space-between" wrap gap={16}>
    <Typography.Text className="ui-pagination__summary" type="secondary">显示 {start}–{end}，共 {total} {itemName}</Typography.Text>
    <AntPagination
      current={safePage}
      pageSize={pageSize}
      total={total}
      pageSizeOptions={PAGE_SIZE_OPTIONS.map(String)}
      showSizeChanger={total > PAGE_SIZE_OPTIONS[0]}
      showQuickJumper={pageCount > 10}
      responsive
      showTitle={false}
      onChange={(nextPage, nextPageSize) => {
        if (nextPageSize !== pageSize) onPageSizeChange(nextPageSize)
        else onPageChange(nextPage)
      }}
    />
  </Flex>
}
