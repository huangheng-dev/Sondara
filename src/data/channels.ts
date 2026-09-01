export type OutreachChannelMode = 'automatic' | 'assisted'

export const outreachChannelDefinitions = [
  { value: '邮件序列', label: '邮件序列 · 自动发送', mode: 'automatic', requirement: '需配置邮件发送服务' },
  { value: 'WhatsApp', label: 'WhatsApp · 自动发送', mode: 'automatic', requirement: '需配置 Cloud API 并记录客户授权' },
  { value: 'LinkedIn 任务', label: 'LinkedIn · 人工任务', mode: 'assisted', requirement: '系统创建任务，由成员完成触达' },
  { value: '电话跟进', label: '电话 · 人工任务', mode: 'assisted', requirement: '系统创建任务，由成员完成通话' },
  { value: '短信', label: '短信 · 人工任务', mode: 'assisted', requirement: '尚未接入短信发送服务' },
  { value: '微信', label: '微信 · 人工任务', mode: 'assisted', requirement: '尚未接入企业微信发送服务' },
] as const satisfies ReadonlyArray<{ value: string; label: string; mode: OutreachChannelMode; requirement: string }>

export const outreachChannels = outreachChannelDefinitions.map(channel => channel.value)
export const outreachChannelOptions = outreachChannelDefinitions.map(channel => ({ value: channel.value, label: channel.label }))

export const customerCommunicationOptions = [
  { value: '邮件', label: '邮件 · 自动发送' },
  { value: 'WhatsApp', label: 'WhatsApp · 自动发送（需授权）' },
  { value: 'LinkedIn', label: 'LinkedIn · 人工任务' },
  { value: '电话', label: '电话 · 人工任务' },
  { value: '短信', label: '短信 · 人工任务' },
  { value: '微信', label: '微信 · 人工任务' },
] as const

export const integrationServices = [
  { name: '搜索与网页 API', description: 'Google、Bing、SerpAPI、Tavily、Brave 或 SearXNG' },
  { name: '地图 API', description: 'Google Places 全球地点与企业发现' },
  { name: '联系人补全 API', description: '内置官网公开邮箱、电话与社交主页核验' },
  { name: '行业与招投标数据', description: '内置公开名录、协会、展会与招投标页面解析' },
  { name: '邮件发送服务', description: 'SMTP、SendGrid、Mailgun、授权 Webhook 与 IMAP 收件' },
] as const
