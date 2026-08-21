export const outreachChannels = [
  '邮件序列', 'LinkedIn 任务', 'WhatsApp', '短信', '电话跟进', '微信', '多渠道组合',
] as const

export const integrationServices = [
  { name: '搜索与网页 API', description: 'Google、Bing、SerpAPI、Tavily、Brave 或 SearXNG' },
  { name: '地图 API', description: 'Google Places 全球地点与企业发现' },
  { name: '联系人补全 API', description: '内置官网公开邮箱、电话与社交主页核验' },
  { name: '行业与招投标数据', description: '内置公开名录、协会、展会与招投标页面解析' },
  { name: '邮件发送服务', description: 'SMTP、SendGrid、Mailgun、授权 Webhook 与 IMAP 收件' },
] as const
