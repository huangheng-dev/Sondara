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

// --- Field auto-cleaning for imported leads ---

/** Collapse internal whitespace and strip control chars. */
const normalizeWhitespace = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Normalize a company name: collapse whitespace, strip trailing/leading
 * punctuation, but DO NOT strip legal suffixes (Co., Ltd, GmbH, Inc., LLC, etc.)
 * because doing so can merge distinct legal entities. We only trim obvious noise
 * like surrounding brackets, quotes, and asterisks.
 */
const cleanCompanyName = (value: string) => {
  let cleaned = normalizeWhitespace(value)
  cleaned = cleaned.replace(/^[\s*"'([【〖]+|[\s*"'")\]】〗]+$/g, '').trim()
  return cleaned
}

/**
 * Normalize country/region names. Handles common Chinese and English variants
 * from exhibition lists and industry directories.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  '中国': '中国', 'china': '中国', 'prc': '中国', "people's republic of china": '中国',
  '美国': '美国', 'usa': '美国', 'u.s.a.': '美国', 'us': '美国', 'united states': '美国', 'united states of america': '美国',
  '德国': '德国', 'germany': '德国', 'deutschland': '德国',
  '英国': '英国', 'uk': '英国', 'u.k.': '英国', 'united kingdom': '英国', 'great britain': '英国',
  '日本': '日本', 'japan': '日本',
  '韩国': '韩国', 'korea': '韩国', 'south korea': '韩国', 'republic of korea': '韩国',
  '法国': '法国', 'france': '法国',
  '意大利': '意大利', 'italy': '意大利', 'italia': '意大利',
  '西班牙': '西班牙', 'spain': '西班牙', 'espana': '西班牙', 'españa': '西班牙',
  '荷兰': '荷兰', 'netherlands': '荷兰', 'holland': '荷兰', 'the netherlands': '荷兰',
  '澳大利亚': '澳大利亚', 'australia': '澳大利亚', 'aus': '澳大利亚',
  '加拿大': '加拿大', 'canada': '加拿大',
  '新加坡': '新加坡', 'singapore': '新加坡',
  '印度': '印度', 'india': '印度',
  '巴西': '巴西', 'brazil': '巴西', 'brasil': '巴西',
  '墨西哥': '墨西哥', 'mexico': '墨西哥', 'méxico': '墨西哥',
  '俄罗斯': '俄罗斯', 'russia': '俄罗斯', 'russian federation': '俄罗斯',
  '阿联酋': '阿联酋', 'uae': '阿联酋', 'u.a.e.': '阿联酋', 'united arab emirates': '阿联酋',
  '土耳其': '土耳其', 'turkey': '土耳其', 'türkiye': '土耳其',
  '波兰': '波兰', 'poland': '波兰',
  '瑞士': '瑞士', 'switzerland': '瑞士', 'swiss': '瑞士',
  '比利时': '比利时', 'belgium': '比利时',
  '瑞典': '瑞典', 'sweden': '瑞典',
  '丹麦': '丹麦', 'denmark': '丹麦',
  '挪威': '挪威', 'norway': '挪威',
  '芬兰': '芬兰', 'finland': '芬兰',
  '奥地利': '奥地利', 'austria': '奥地利',
  '捷克': '捷克', 'czech': '捷克', 'czech republic': '捷克', 'czechia': '捷克',
  '葡萄牙': '葡萄牙', 'portugal': '葡萄牙',
  '希腊': '希腊', 'greece': '希腊',
  '爱尔兰': '爱尔兰', 'ireland': '爱尔兰',
  '越南': '越南', 'vietnam': '越南', 'viet nam': '越南',
  '泰国': '泰国', 'thailand': '泰国',
  '马来西亚': '马来西亚', 'malaysia': '马来西亚',
  '印度尼西亚': '印度尼西亚', 'indonesia': '印度尼西亚',
  '菲律宾': '菲律宾', 'philippines': '菲律宾',
  '新西兰': '新西兰', 'new zealand': '新西兰',
  '南非': '南非', 'south africa': '南非',
  '阿根廷': '阿根廷', 'argentina': '阿根廷',
  '智利': '智利', 'chile': '智利',
  '哥伦比亚': '哥伦比亚', 'colombia': '哥伦比亚',
  '秘鲁': '秘鲁', 'peru': '秘鲁',
  '沙特': '沙特', 'saudi': '沙特', 'saudi arabia': '沙特', 'ksa': '沙特',
  '以色列': '以色列', 'israel': '以色列',
  '埃及': '埃及', 'egypt': '埃及',
  '尼日利亚': '尼日利亚', 'nigeria': '尼日利亚',
  '肯尼亚': '肯尼亚', 'kenya': '肯尼亚',
  '香港': '中国香港', 'hong kong': '中国香港', 'hk': '中国香港',
  '澳门': '中国澳门', 'macao': '中国澳门', 'macau': '中国澳门',
  '台湾': '中国台湾', 'taiwan': '中国台湾', 'chinese taipei': '中国台湾',
}

const cleanRegion = (value: string) => {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return '待映射'
  const key = normalized.toLowerCase().replace(/\s+/g, ' ')
  return COUNTRY_ALIASES[key] ?? normalized
}

/** Normalize a website URL: trim, lowercase host, ensure protocol, strip trailing slash and query. */
const cleanWebsite = (value: string) => {
  let url = normalizeWhitespace(value)
  if (!url) return ''
  // Strip protocol for processing
  url = url.replace(/^https?:\/\//i, '').replace(/^\/+/, '')
  // Strip path, query, fragment for a canonical domain (keep only host)
  url = url.split('/')[0]!.split('?')[0]!.split('#')[0]!
  url = url.toLowerCase().trim()
  if (!url) return ''
  return `https://${url}`
}

/** Lowercase and trim email; strip mailto: prefix and angle brackets. */
const cleanEmail = (value: string) => {
  let email = normalizeWhitespace(value)
  if (!email) return ''
  email = email.replace(/^mailto:/i, '').replace(/[<>()[\]{}]/g, '').trim().toLowerCase()
  // Basic sanity: must contain @
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ''
  return email
}

/** Normalize phone: keep leading + and digits, strip everything else. Returns '' if fewer than 4 digits. */
const cleanPhone = (value: string) => {
  let phone = normalizeWhitespace(value)
  if (!phone) return ''
  const hasPlus = phone.trimStart().startsWith('+')
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return ''
  return hasPlus ? `+${digits}` : digits
}

const cleanIndustry = (value: string) => normalizeWhitespace(value)

export function csvRowsToCustomers(rows: CsvRow[], mapping: LeadColumnMapping = {}): Array<{ company: string; region: string; industry: string; score: number; confidence: number; signal: string; source: string; size: string; stage: string; contacts: number; validContacts: number; interaction: string; nextAction: string; estimatedValue: number; contactName?: string; contactTitle?: string; contactEmail?: string; contactPhone?: string; website?: string }> {
  return rows.map(row => {
    const mapped = (key: keyof LeadColumnMapping, aliases: string[]) => mapping[key] ? pickValue(row, [mapping[key]!]) : pickValue(row, aliases)
    const company = cleanCompanyName(mapped('company', ['company', '企业名称', '公司名称', '公司', '客户名称', 'customer']))
    const website = cleanWebsite(mapped('website', ['website', '官网', '官方网站', '网站', 'domain', '网址']))
    const region = cleanRegion(mapped('region', ['region', '地区', '国家', '区域', '市场', 'country', 'market']) || '待映射')
    const industry = cleanIndustry(mapped('industry', ['industry', '行业', '领域', 'vertical']) || '待映射')
    const signal = normalizeWhitespace(mapped('signal', ['signal', '购买信号', '需求', '备注', 'notes', '来源', 'source']) || 'CSV 名单导入，待人工复核')
    const score = parseInt100(pickValue(row, ['score', '匹配分', '评分']))
    const contacts = Number.parseInt(pickValue(row, ['contacts', '联系人', '联系人数量', 'contact']), 10)
    const contactName = normalizeWhitespace(mapped('contactName', ['contact name', '联系人姓名', '联系人', '姓名', 'name']))
    const contactTitle = normalizeWhitespace(mapped('contactTitle', ['contact title', '职位', '职务', 'title', 'job title']))
    const contactEmail = cleanEmail(mapped('contactEmail', ['contact email', '邮箱', 'email', 'e-mail']))
    const contactPhone = cleanPhone(mapped('contactPhone', ['contact phone', '电话', '手机号', 'phone', 'mobile', 'whatsapp']))
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
