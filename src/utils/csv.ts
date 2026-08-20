export type CsvRow = Record<string, string>

const cleanCell = (value: string) => value.replace(/^\ufeff/, '').trim()

export function parseCsv(text: string): CsvRow[] {
  const input = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cleanCell(cell))
      cell = ''
    } else if (char === '\n' && !inQuotes) {
      row.push(cleanCell(cell))
      if (row.some(value => value.length > 0)) records.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cleanCell(cell))
  if (row.some(value => value.length > 0)) records.push(row)
  const [headerRow, ...dataRows] = records
  if (!headerRow) return []
  const headers = headerRow.map((header, index) => header || `column_${index + 1}`)
  return dataRows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const pickValue = (row: CsvRow, keys: string[]) => {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]))
  for (const key of keys) {
    const value = normalized[key.toLowerCase()]
    if (value) return value
  }
  return ''
}

const parseInt100 = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 60
}

export function csvRowsToCustomers(rows: CsvRow[]): Array<{ company: string; region: string; industry: string; score: number; confidence: number; signal: string; source: string; size: string; stage: string; contacts: number; validContacts: number; interaction: string; nextAction: string; estimatedValue: number }> {
  return rows.map(row => {
    const company = pickValue(row, ['company', '企业名称', '公司名称', '公司', '客户名称', 'customer'])
    const website = pickValue(row, ['website', '官网', '官方网站', '网站', 'domain', '网址'])
    const region = pickValue(row, ['region', '地区', '国家', '区域', '市场', 'country', 'market']) || '待映射'
    const industry = pickValue(row, ['industry', '行业', '领域', 'vertical']) || '待映射'
    const signal = pickValue(row, ['signal', '购买信号', '需求', '备注', 'notes', '来源', 'source']) || 'CSV 名单导入，待人工复核'
    const score = parseInt100(pickValue(row, ['score', '匹配分', '评分']))
    const contacts = Number.parseInt(pickValue(row, ['contacts', '联系人', '联系人数量', 'contact']), 10)
    return {
      company,
      region,
      industry,
      score,
      confidence: Math.max(40, score - 10),
      signal,
      source: website ? `CSV · ${website.slice(0, 110)}` : 'CSV 导入',
      size: pickValue(row, ['size', '规模', 'company size']) || '待补全',
      stage: pickValue(row, ['stage', '阶段', 'status', '关系阶段']) || '待补全',
      contacts: Number.isFinite(contacts) ? Math.max(0, contacts) : 0,
      validContacts: 0,
      interaction: '刚刚导入',
      nextAction: pickValue(row, ['next', '下一步', '跟进建议', 'next action']) || '完成字段映射与首次触达',
      estimatedValue: 0,
    }
  }).filter(row => row.company.trim().length > 0)
}
