import readXlsxFile from 'read-excel-file'

export type CsvRow = Record<string, string>
export type LeadColumnMapping = Partial<{ company: string; region: string; industry: string; contactName: string; contactTitle: string; contactEmail: string; contactPhone: string; website: string; signal: string }>

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

export async function parseLeadFile(file: File): Promise<CsvRow[]> {
  const fileName = file.name.toLowerCase()
  if (fileName.endsWith('.csv')) return parseCsv(await file.text())
  if (fileName.endsWith('.pdf')) return parsePdfLeadFile(file)
  if (!fileName.endsWith('.xlsx')) throw new Error('仅支持 CSV、XLSX 或可提取文本的 PDF 文件。')
  return (await readXlsxFile(file))
    .filter(row => Array.isArray(row) && row.some(cell => String(cell).trim()))
    .map(row => row.map(cell => String(cell ?? '')))
    .reduce<CsvRow[]>((all, row, index, rows) => {
      if (index === 0) return all
      const headers = rows[0]?.map((header, column) => cleanCell(String(header)) || `column_${column + 1}`) ?? []
      all.push(Object.fromEntries(headers.map((header, column) => [header, cleanCell(String(row[column] ?? ''))])))
      return all
    }, [])
}

const parsePdfLeadFile = async (file: File): Promise<CsvRow[]> => {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWorkerFetch: false }).promise
  const lines: string[] = []
  for (let page = 1; page <= document.numPages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent()
    let current = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      const value = item.str.trim()
      if (!value) continue
      current += `${current ? ' ' : ''}${value}`
      if (item.hasEOL) { lines.push(current); current = '' }
    }
    if (current) lines.push(current)
  }
  const candidates = lines.map(line => line.trim()).filter(line => line.length >= 2 && line.length <= 500)
  if (!candidates.length) throw new Error('PDF 中没有可提取文本；请使用可搜索的 PDF，或导出为 CSV/XLSX 后导入。')
  const headerIndex = candidates.findIndex(line => /公司|企业|company|exhibitor|参展商/i.test(line) && /地区|国家|country|行业|industry|联系人|contact/i.test(line))
  if (headerIndex >= 0) {
    const headers = candidates[headerIndex].split(/\s{2,}|\||\t/).map((value, index) => cleanCell(value) || `column_${index + 1}`)
    const rows = candidates.slice(headerIndex + 1).map(line => line.split(/\s{2,}|\||\t/).map(cleanCell)).filter(values => values.length >= 2)
    if (rows.length) return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
  }
  return candidates.map((line, index) => ({ company: line, source_line: String(index + 1) }))
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

export function csvRowsToCustomers(rows: CsvRow[], mapping: LeadColumnMapping = {}): Array<{ company: string; region: string; industry: string; score: number; confidence: number; signal: string; source: string; size: string; stage: string; contacts: number; validContacts: number; interaction: string; nextAction: string; estimatedValue: number; contactName?: string; contactTitle?: string; contactEmail?: string; contactPhone?: string; website?: string }> {
  return rows.map(row => {
    const mapped = (key: keyof LeadColumnMapping, aliases: string[]) => mapping[key] ? pickValue(row, [mapping[key]!]) : pickValue(row, aliases)
    const company = mapped('company', ['company', '企业名称', '公司名称', '公司', '客户名称', 'customer'])
    const website = mapped('website', ['website', '官网', '官方网站', '网站', 'domain', '网址'])
    const region = mapped('region', ['region', '地区', '国家', '区域', '市场', 'country', 'market']) || '待映射'
    const industry = mapped('industry', ['industry', '行业', '领域', 'vertical']) || '待映射'
    const signal = mapped('signal', ['signal', '购买信号', '需求', '备注', 'notes', '来源', 'source']) || 'CSV 名单导入，待人工复核'
    const score = parseInt100(pickValue(row, ['score', '匹配分', '评分']))
    const contacts = Number.parseInt(pickValue(row, ['contacts', '联系人', '联系人数量', 'contact']), 10)
    const contactName = mapped('contactName', ['contact name', '联系人姓名', '联系人', '姓名', 'name'])
    const contactTitle = mapped('contactTitle', ['contact title', '职位', '职务', 'title', 'job title'])
    const contactEmail = mapped('contactEmail', ['contact email', '邮箱', 'email', 'e-mail'])
    const contactPhone = mapped('contactPhone', ['contact phone', '电话', '手机号', 'phone', 'mobile', 'whatsapp'])
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
      ...(contactName ? { contactName } : {}),
      ...(contactTitle ? { contactTitle } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      ...(website ? { website } : {}),
    }
  }).filter(row => row.company.trim().length > 0)
}
