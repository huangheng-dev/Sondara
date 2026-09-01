const excludedHosts = [
  // 社交/视频
  'linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
  'weibo.com', 'weixin.qq.com', 'douyin.com', 'tiktok.com', 'vk.com',
  // 百科/问答/社区
  'wikipedia.org', 'wikimedia.org', 'baike.baidu.com', 'zhihu.com', 'quora.com', 'reddit.com',
  // B2B 平台
  'alibaba.com', 'made-in-china.com', 'globalsources.com', '1688.com', 'hc360.com',
  'bossgoo.com', 'ecvv.com', 'tradekey.com', 'europages.com', 'kompass.com', 'yelp.com',
  // 招聘
  'zhipin.com', '51job.com', 'zhaopin.com', 'lagou.com', 'liepin.com', 'indeed.com', 'glassdoor.com',
  // 财经/数据库/监管
  'bloomberg.com', 'reuters.com', 'crunchbase.com', 'zoominfo.com', 'sec.gov',
  // 市场报告/研究机构
  'marketsandmarkets.com', 'grandviewresearch.com', 'fortunebusinessinsights.com', 'mordorintelligence.com', 'researchandmarkets.com', 'technavio.com', 'imarcgroup.com', 'thomasnet.com',
  // 搜索引擎/门户
  'google.com', 'bing.com', 'baidu.com', 'sogou.com', 'so.com', 'yahoo.com', 'sina.com.cn',
  'sohu.com', 'qq.com', 'ifeng.com', '163.com', 'eastmoney.com',
  // 政府/教育/公益
  'gov.cn', 'gov', 'edu.cn', 'org.cn',
  // 文档/文库
  'wenku.baidu.com', 'docin.com', 'doc88.com', 'book118.com', 'slideshare.net', 'scribd.com',
  // 代码/技术社区
  'github.com', 'gitee.com', 'gitlab.com', 'stackoverflow.com', 'csdn.net', 'jianshu.com',
  'cnblogs.com', 'gys.cn', 'wikifx.com', 'wikiresearch.com',
  // 电商
  'amazon.com', 'jd.com', 'taobao.com', 'tmall.com', 'pinduoduo.com',
  // 地图/点评
  'amap.com', 'dianping.com', 'map.baidu.com',
]

export const isExcludedHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return excludedHosts.some(domain => {
    if (domain === 'gov') return host.endsWith('.gov') || host.endsWith('.gov.cn') || host === 'gov.cn'
    if (domain === 'org.cn') return host.endsWith('.org.cn')
    if (domain === 'edu.cn') return host.endsWith('.edu.cn')
    return host === domain || host.endsWith(`.${domain}`)
  })
}
