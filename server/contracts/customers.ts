import { z } from 'zod'
import { booleanQuerySchema } from './query.js'

export const customerInputSchema = z.object({
  company: z.string().trim().min(1).max(160),
  region: z.string().trim().max(80).default('待补全'),
  industry: z.string().trim().max(120).default('待补全'),
  score: z.number().int().min(0).max(100).default(0),
  confidence: z.number().int().min(0).max(100).default(0),
  signal: z.string().trim().max(160).default('待识别'),
  source: z.string().trim().max(120).default('手动录入'),
  estimatedValue: z.number().int().min(0).default(0),
  size: z.string().trim().max(80).default('待补全'),
  stage: z.string().trim().max(40).default('待补全'),
  contacts: z.number().int().min(0).default(0),
  validContacts: z.number().int().min(0).default(0),
  interaction: z.string().trim().max(160).default('尚无互动'),
  nextAction: z.string().trim().max(200).default('补全企业档案'),
  dueAt: z.number().int().nullable().optional(),
  ownerUserId: z.string().trim().min(1).nullable().optional(),
})

export const customerPatchSchema = customerInputSchema.partial()

const customerImportRowSchema = customerInputSchema.extend({
  contactName: z.string().trim().max(100).optional(),
  contactTitle: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(240).optional(),
})

export const customerImportInputSchema = z.object({
  sourceName: z.string().trim().min(2).max(100),
  sourceType: z.enum(['行业目录', '展会名单', '历史客户', '其他']).default('其他'),
  sourceUrl: z.string().trim().url().max(240).optional(),
  rows: z.array(customerImportRowSchema).min(1).max(1000),
})

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  region: z.string().trim().optional(),
  stage: z.string().trim().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'updated_asc', 'score_desc', 'score_asc', 'company_asc']).default('updated_desc'),
  includeArchived: booleanQuerySchema,
  archivedOnly: booleanQuerySchema,
})

export const customerMergeInputSchema = z.object({
  primaryCustomerId: z.string().trim().min(1),
  duplicateCustomerId: z.string().trim().min(1),
}).refine(value => value.primaryCustomerId !== value.duplicateCustomerId, {
  message: '请选择两家不同的客户。',
})

export type CustomerInput = z.input<typeof customerInputSchema>
export type CustomerImportRowInput = z.input<typeof customerImportRowSchema>
