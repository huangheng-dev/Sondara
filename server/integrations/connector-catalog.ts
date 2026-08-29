export type ConnectorField = {
  key: string
  label: string
  type: 'text' | 'url' | 'password' | 'select'
  required?: boolean
  secret?: boolean
  options?: string[]
  placeholder?: string
  defaultValue?: string
}

export type ConnectorCatalogItem = {
  key: string
  tier: 'P2'
  category: 'data-enrichment' | 'verification' | 'supply-chain' | 'crm' | 'visitor' | 'vertical-data'
  name: string
  description: string
  examples: string[]
  fields: ConnectorField[]
}

const providerField: ConnectorField = { key: 'providerName', label: '服务商名称', type: 'text', required: true, placeholder: '填写实际购买或使用的服务商' }
const endpointField: ConnectorField = { key: 'endpoint', label: 'API 接口地址', type: 'url', required: true, placeholder: 'https://api.provider.example/v1' }
const apiKeyField: ConnectorField = { key: 'apiKey', label: 'API Key / Access Token', type: 'password', required: true, secret: true, placeholder: '首次配置必填；加密保存，更新时留空可保留原值' }
const accountField: ConnectorField = { key: 'accountId', label: '账户 / Workspace ID', type: 'text', placeholder: '可选；按服务商要求填写' }

export const externalConnectorCatalog: ConnectorCatalogItem[] = [
  {
    key: 'company-contact-database', tier: 'P2', category: 'data-enrichment', name: '企业与联系人数据库',
    description: '按企业域名、地区和职位补全企业及公开商务联系人。', examples: ['Apollo', 'People Data Labs', 'ZoomInfo'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Apollo'], defaultValue: 'Apollo' }, { ...providerField, defaultValue: 'Apollo' }, { ...endpointField, defaultValue: 'https://api.apollo.io/api/v1/mixed_people/api_search' }, accountField, apiKeyField],
  },
  {
    key: 'email-verification', tier: 'P2', category: 'verification', name: '邮箱验证服务',
    description: '验证邮箱可达性、风险和一次性邮箱，不自动发送营销邮件。', examples: ['Hunter', 'ZeroBounce', 'NeverBounce'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Hunter', 'ZeroBounce', 'NeverBounce'], defaultValue: 'Hunter' }, { ...providerField, defaultValue: 'Hunter' }, { ...endpointField, defaultValue: 'https://api.hunter.io/v2/email-verifier', placeholder: 'Hunter、ZeroBounce 或 NeverBounce 官方单邮箱验证端点' }, accountField, apiKeyField],
  },
  {
    key: 'phone-verification', tier: 'P2', category: 'verification', name: '电话验证服务',
    description: '规范化国际号码并识别号码类型、国家和有效性。', examples: ['Twilio Lookup', 'Vonage Number Insight'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Twilio Lookup'], defaultValue: 'Twilio Lookup' }, { ...providerField, defaultValue: 'Twilio Lookup' }, { ...endpointField, defaultValue: 'https://lookups.twilio.com/v2/PhoneNumbers' }, { key: 'accountSid', label: 'Account SID / API Key SID', type: 'text', required: true }, { key: 'authToken', label: 'Auth Token / API Key Secret', type: 'password', required: true, secret: true, placeholder: '首次配置必填；加密保存' }],
  },
  {
    key: 'trade-supply-chain-data', tier: 'P2', category: 'supply-chain', name: '海关与供应链数据',
    description: '接入合法授权的进出口、提单或供应链关系数据。', examples: ['ImportGenius', 'Panjiva', 'ImportYeti'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Generic REST'], defaultValue: 'Generic REST' }, providerField, endpointField, accountField, apiKeyField, { key: 'itemsPath', label: '列表数据路径', type: 'text', placeholder: '例如 data.items；留空时自动识别 items/data/results' }, { key: 'fieldMapping', label: '字段路径映射（JSON）', type: 'text', placeholder: '{"company":"buyer.name","id":"record_id","region":"country"}' }],
  },
  {
    key: 'crm-sync', tier: 'P2', category: 'crm', name: 'CRM 双向同步',
    description: '预留客户、联系人、任务和商机的双向同步配置。', examples: ['HubSpot', 'Salesforce', 'Pipedrive'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['HubSpot'], defaultValue: 'HubSpot' }, { ...providerField, defaultValue: 'HubSpot' }, { ...endpointField, defaultValue: 'https://api.hubapi.com/crm/v3/objects/contacts' }, accountField, { key: 'clientId', label: 'OAuth Client ID', type: 'text' }, { key: 'clientSecret', label: 'OAuth Client Secret', type: 'password', secret: true }, { key: 'accessToken', label: 'Private App Access Token / OAuth Refresh Token', type: 'password', required: true, secret: true }, { key: 'syncDirection', label: '同步方向', type: 'select', required: true, options: ['双向同步', '仅导入到 Sondara', '仅导出到 CRM'], defaultValue: '双向同步' }],
  },
  {
    key: 'website-visitor-identification', tier: 'P2', category: 'visitor', name: '网站访客识别',
    description: '接收授权的网站访客公司识别事件，并作为已有企业的意向信号。', examples: ['Dealfront', 'Albacross', 'Leadfeeder'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Generic Webhook'], defaultValue: 'Generic Webhook' }, providerField, accountField, { key: 'webhookSecret', label: 'Webhook 签名密钥', type: 'password', required: true, secret: true }],
  },
  {
    key: 'vertical-industry-database', tier: 'P2', category: 'vertical-data', name: '垂直行业数据库',
    description: '接入用户所在行业的授权企业、项目或专业名录。', examples: ['行业数据库', '协会数据库', '自有数据服务'],
    fields: [{ key: 'providerKey', label: '适配器', type: 'select', required: true, options: ['Generic REST'], defaultValue: 'Generic REST' }, providerField, endpointField, accountField, apiKeyField, { key: 'itemsPath', label: '列表数据路径', type: 'text', placeholder: '例如 data.items；留空时自动识别 items/data/results' }, { key: 'fieldMapping', label: '字段路径映射（JSON）', type: 'text', placeholder: '{"company":"organization.name","industry":"sector","website":"domain"}' }],
  },
]

export const connectorCatalogByKey = new Map(externalConnectorCatalog.map(item => [item.key, item]))
