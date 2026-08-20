export const discoveryChannels = [
  '智能多渠道', '地图找客', '企业官网', '搜索引擎', '行业名录', '展会协会',
  '招投标项目', '招聘扩产', '新闻融资', '种子名单', '贸易海关', '社交网络',
] as const

export const outreachChannels = [
  '邮件序列', 'LinkedIn 任务', 'WhatsApp', '短信', '电话跟进', '微信', '多渠道组合',
] as const

export const attributionModels = [
  '首次触达归因', '末次触达归因', '线性归因', '位置归因', '时间衰减归因',
] as const

export const integrationServices = [
  { name: '搜索与网页 API', description: '官网、搜索引擎与公开网页发现', providers: ['Google Custom Search', 'Bing Web Search', 'SerpAPI', 'Tavily Search API', 'Brave Search API', 'SearXNG 自建服务'] },
  { name: '地图 API', description: '地图与本地企业数据发现', providers: ['Google Places API'] },
  { name: '联系人补全 API', description: '已内置官网公开邮箱、电话与社交主页核验', providers: ['内置公开页面解析'] },
  { name: '行业与招投标数据', description: '已内置公开名录、协会、展会与招投标页面解析', providers: ['内置公开来源解析'] },
  { name: '邮件发送服务', description: '发送域名、退信、退订与送达追踪', providers: ['Resend', 'Amazon SES', 'SendGrid', 'SMTP'] },
] as const
