import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCandidateGeography, getSearchLocale, resolveRunTargetRegion, toInternationalSearchText } from '../radar/market-targeting.js'
import type { DiscoveredCandidate } from '../radar/types.js'
import { isLikelyCompanyName } from '../radar/connectors/website-seed.js'

const candidate = (input: Partial<DiscoveredCandidate>): DiscoveredCandidate => ({
  company: 'Acme Process GmbH', region: '待补全', industry: 'process equipment', size: '待补全', score: 80,
  signal: 'official website', source: '企业官网', estimatedValue: 0, currency: 'EUR', confidence: 80,
  reason: 'Industrial process equipment supplier', dimensions: [], committee: [], relationships: [], evidence: [], ...input,
})

test('全球计划会按轮次落到不同的具体海外国家', () => {
  const first = resolveRunTargetRegion('全球海外市场（自动轮换国家）', 1)
  const second = resolveRunTargetRegion('全球海外市场（自动轮换国家）', 2)
  assert.match(first, /德国|Germany/)
  assert.notEqual(first, second)
})

test('欧洲计划只轮换欧洲国家并生成对应搜索区域', () => {
  const region = resolveRunTargetRegion('欧洲（自动轮换国家）', 3)
  assert.match(region, /法国|France/)
  assert.equal(getSearchLocale(region).countryCode, 'FR')
})

test('中文 ICP 会转换为可用于海外搜索的英文行业词', () => {
  const text = toInternationalSearchText('高洁净制药与食品饮料设备经销商、系统集成商')
  assert.match(text, /hygienic/)
  assert.match(text, /pharmaceutical/)
  assert.match(text, /distributor/)
})

test('中国域名和中国地址不能进入海外候选池', () => {
  const result = assessCandidateGeography({ targetRegion: '德国（Germany）', researchLanguage: '自动识别' }, candidate({
    company: '包头市设计院有限公司', region: '内蒙古包头市', relationships: [{ label: '企业官网', value: 'https://example.cn/' }],
  }))
  assert.equal(result.allowed, false)
})

test('目标国家官网域名可以验证并规范化地区', () => {
  const result = assessCandidateGeography({ targetRegion: '德国（Germany）', researchLanguage: '自动识别' }, candidate({
    relationships: [{ label: '企业官网', value: 'https://acme-process.de/' }],
  }))
  assert.equal(result.allowed, true)
  if (result.allowed) assert.equal(result.candidate.region, '德国（Germany）')
})

test('公开信息指向其他国家时不能混入当前国家任务', () => {
  const result = assessCandidateGeography({ targetRegion: '德国（Germany）', researchLanguage: '英语' }, candidate({
    region: 'Texas, United States', relationships: [{ label: '企业官网', value: 'https://acme.us/' }],
  }))
  assert.equal(result.allowed, false)
})

test('无法验证国家的通用域名不会被宽泛地区标签冒充', () => {
  const result = assessCandidateGeography({ targetRegion: '德国（Germany）', researchLanguage: '英语' }, candidate({
    relationships: [{ label: '企业官网', value: 'https://example.com/' }],
  }))
  assert.equal(result.allowed, false)
})

test('目录导航文字 Company 不会被识别为企业', () => {
  assert.equal(isLikelyCompanyName('Company'), false)
  assert.equal(isLikelyCompanyName('AP&S International GmbH'), true)
})
