import { BarChart3, Bot, Building2, CalendarCheck2, CheckCircle2, Database, FileClock, Gauge, Inbox, KeyRound, PenLine, Radar, Target, Users, UsersRound } from 'lucide-react'
import type { NavItem } from '@/types'

export const navigation: NavItem[] = [
  { label: '经营总览', path: '/dashboard', icon: Gauge },
  { label: '客户定位', path: '/icp', icon: Target },
  { label: 'AI 获客', path: '/radar', icon: Radar },
  { label: '客户库', path: '/customers', icon: Building2 },
  { label: '内容创作', path: '/content', icon: PenLine },
  { label: '营销活动', path: '/campaigns', icon: CalendarCheck2 },
  { label: '客户消息', path: '/inbox', icon: Inbox },
  { label: '商机跟进', path: '/pipeline', icon: Users },
  { label: '转化分析', path: '/attribution', icon: BarChart3 },
]

export const settingsNavigation: NavItem[] = [
  { label: 'AI 模型配置', path: '/settings/ai', icon: Bot },
  { label: '数据源集成', path: '/settings/integrations', icon: KeyRound },
  { label: '官方线索渠道', path: '/settings/lead-sources', icon: Target },
  { label: '数据与备份', path: '/settings/data', icon: Database },
]

export const adminNavigation: NavItem[] = [
  { label: '用户与成员', path: '/admin/users', icon: UsersRound },
  { label: '角色与权限', path: '/admin/roles', icon: KeyRound },
  { label: '操作记录', path: '/admin/audit-logs', icon: FileClock },
  { label: '审批中心', path: '/admin/approvals', icon: CheckCircle2 },
]
