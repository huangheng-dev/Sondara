import { useEffect, useMemo, useState } from 'react'

export function usePagination<T>(items: T[], initialPageSize = 6, resetKey = '') {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))

  useEffect(() => setPage(1), [resetKey])
  useEffect(() => setPage(current => Math.min(current, pageCount)), [pageCount])

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  const setPageSize = (next: number) => {
    setPageSizeState(next)
    setPage(1)
  }

  return { page, pageSize, pageCount, pageItems, setPage, setPageSize }
}
