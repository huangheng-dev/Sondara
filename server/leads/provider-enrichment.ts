type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

const localizedText = (value: unknown) => {
  const item = asObject(value)
  const localized = asObject(item.localized)
  return Object.values(localized).map(scalar).find(Boolean) ?? Object.values(item).map(scalar).find(Boolean) ?? ''
}

const linkedinAnswerValue = (answer: JsonObject) => {
  const accepted = asObject(answer.accepted)
  const answerDetails = asObject(answer.answerDetails)
  const textAnswer = asObject(answerDetails.textQuestionAnswer)
  const acceptedText = scalar(accepted.answer)
  const directText = scalar(answer.answer)
  const nestedText = scalar(textAnswer.answer)
  if (acceptedText || directText || nestedText) return acceptedText || directText || nestedText
  const acceptedOptions = asArray(accepted.options).map(scalar).filter(Boolean)
  const nestedOptions = asArray(asObject(answerDetails.multipleChoiceAnswer).options).map(scalar).filter(Boolean)
  return [...acceptedOptions, ...nestedOptions].join(', ')
}

const linkedinLeadId = (value: unknown) => {
  const text = scalar(value)
  if (!text) return ''
  return text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text
}

export class ProviderLeadFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ProviderLeadFetchError'
  }
}

export const metaLeadId = (value: unknown): string => {
  const item = asObject(value)
  const direct = scalar(item.leadgen_id ?? item.lead_id)
  if (direct) return direct
  for (const entry of asArray(item.entry)) {
    for (const change of asArray(asObject(entry).changes)) {
      const found = metaLeadId(asObject(change).value)
      if (found) return found
    }
  }
  return ''
}

export const fetchMetaLeadResponse = async ({
  notification,
  accessToken,
  graphApiVersion,
  fetcher = fetch,
}: {
  notification: unknown
  accessToken: string
  graphApiVersion: string
  fetcher?: typeof fetch
}) => {
  const id = metaLeadId(notification)
  if (!id) throw new ProviderLeadFetchError('Meta 通知缺少 leadgen_id。')
  if (!accessToken) throw new ProviderLeadFetchError('Meta 连接缺少访问 Token。')
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(id)}`)
  url.searchParams.set('fields', 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform')
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ProviderLeadFetchError(`Meta 线索详情读取失败（HTTP ${response.status}）。`, response.status)
  }
  const lead = asObject(await response.json())
  return {
    ...lead,
    provider_notification: notification,
    provider_lead_id: scalar(lead.id) || id,
  }
}

export const fetchLinkedinLeadResponse = async ({
  notification,
  accessToken,
  apiVersion,
  fetcher = fetch,
}: {
  notification: unknown
  accessToken: string
  apiVersion: string
  fetcher?: typeof fetch
}) => {
  const notice = asObject(notification)
  const id = linkedinLeadId(notice.leadGenFormResponse ?? notice.id)
  if (!id) throw new ProviderLeadFetchError('LinkedIn 通知缺少 Lead Form Response ID。')
  if (!accessToken) throw new ProviderLeadFetchError('LinkedIn 连接缺少访问 Token。')

  const fields = 'ownerInfo,associatedEntityInfo,leadMetadataInfo,owner,leadType,versionedLeadGenFormUrn,id,submittedAt,testLead,formResponse,form:(hiddenFields,creationLocale,name,id,content)'
  const url = new URL(`https://api.linkedin.com/rest/leadFormResponses/${encodeURIComponent(id)}`)
  url.searchParams.set('fields', fields)
  const response = await fetcher(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'linkedin-version': apiVersion,
      'x-restli-protocol-version': '2.0.0',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ProviderLeadFetchError(`LinkedIn 线索详情读取失败（HTTP ${response.status}）。`, response.status)
  }

  const lead = asObject(await response.json())
  const form = asObject(lead.form)
  const content = asObject(form.content)
  const questions = asArray(content.questions).map(asObject)
  const questionNames = new Map<string, string>()
  for (const question of questions) {
    const questionId = scalar(question.questionId)
    if (!questionId) continue
    questionNames.set(questionId,
      scalar(question.predefinedField)
      || scalar(question.name)
      || scalar(question.label)
      || localizedText(question.question)
      || `question_${questionId}`,
    )
  }

  const formResponse = asObject(lead.formResponse)
  const answers = asArray(formResponse.answers).map(asObject)
  const fieldData = answers.map(answer => ({
    field_name: questionNames.get(scalar(answer.questionId)) || scalar(answer.name) || `question_${scalar(answer.questionId)}`,
    value: linkedinAnswerValue(answer),
  })).filter(item => item.field_name && item.value)
  const hiddenFields = asArray(form.hiddenFields).map(asObject).map(item => ({
    field_name: scalar(item.name),
    value: scalar(item.value),
  })).filter(item => item.field_name && item.value)

  return {
    field_data: [...fieldData, ...hiddenFields],
    provider_notification: notice,
    provider_lead_id: scalar(lead.id) || id,
    provider_lead_type: scalar(lead.leadType),
    provider_submitted_at: scalar(lead.submittedAt),
  }
}
