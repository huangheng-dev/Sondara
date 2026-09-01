import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAllPages, type ListResponse } from './core'

test('collectAllPages loads every available page in stable order', async () => {
  const values = Array.from({ length: 235 }, (_, index) => index + 1)
  const requested: number[] = []
  const fetchPage = async (page: number, pageSize: number): Promise<ListResponse<number>> => {
    requested.push(page)
    const start = (page - 1) * pageSize
    return { items: values.slice(start, start + pageSize), page, pageSize, total: values.length }
  }

  const result = await collectAllPages(fetchPage)
  assert.deepEqual(result.items, values)
  assert.deepEqual(requested, [1, 2, 3])
  assert.equal(result.total, values.length)
})

test('collectAllPages respects its item safety limit', async () => {
  const values = Array.from({ length: 400 }, (_, index) => index)
  const fetchPage = async (page: number, pageSize: number): Promise<ListResponse<number>> => {
    const start = (page - 1) * pageSize
    return { items: values.slice(start, start + pageSize), page, pageSize, total: values.length }
  }

  const result = await collectAllPages(fetchPage, { pageSize: 50, maxItems: 120 })
  assert.equal(result.items.length, 120)
  assert.deepEqual(result.items, values.slice(0, 120))
  assert.equal(result.total, values.length)
})
