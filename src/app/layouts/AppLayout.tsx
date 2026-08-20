import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AutoComplete, Avatar, Badge as AntBadge, Drawer, Dropdown, Input, Layout, Menu as AntMenu, Popover, type InputRef, type MenuProps } from 'antd'
import { Bell, CheckCheck, ChevronLeft, ChevronRight, LogOut, Menu, Search, Settings, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { adminNavigation, navigation, settingsNavigation } from '@/app/navigation'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { authApi, inboxApi } from '@/lib/api'
import { useBusinessStore } from '@/stores/business-store'
import { useUiStore } from '@/stores/ui-store'

const { Header, Content, Sider } = Layout

export function AppLayout() {
  const { collapsed, toggleSidebar } = useUiStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<InputRef>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const customers = useBusinessStore(state => state.customers)
  const accountPreferences = useBusinessStore(state => state.accountPreferences)
  const authSession = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })
  const canManageWorkspace = ['owner', 'admin'].includes(authSession.data?.workspace.role ?? '')
  const inboxPreview = useQuery({ queryKey: ['inbox-threads', 'shell-preview'], queryFn: () => inboxApi.listThreads({ limit: 50 }), retry: 1 })
  const inboxUnread = inboxPreview.data?.unreadTotal ?? 0
  const displayName = accountPreferences?.displayName?.trim() || authSession.data?.user.displayName?.trim() || '我的账户'
  const avatarText = displayName.slice(0, 1)

  useEffect(() => setUnreadCount(inboxUnread), [inboxUnread])
  useEffect(() => {
    setMobileOpen(false)
    setAccountOpen(false)
    setNotificationsOpen(false)
    setSearchOpen(false)
    setQuery('')
  }, [location.pathname, location.search])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []
    return [
      ...[...navigation, ...(canManageWorkspace ? [...settingsNavigation, ...adminNavigation] : [])].filter(item => item.label.toLowerCase().includes(keyword)).slice(0, 3).map(item => ({ title: item.label, meta: '功能页面', path: item.path })),
      ...customers.filter(item => `${item.company}${item.region}${item.industry}${item.signal}`.toLowerCase().includes(keyword)).slice(0, 4).map(item => ({ title: item.company, meta: `客户 · ${item.region} · 匹配度 ${item.score}`, path: '/customers' })),
      ...(inboxPreview.data?.items ?? []).filter(item => `${item.contact.name}${item.contact.company}${item.lastMessagePreview}${item.channel}`.toLowerCase().includes(keyword)).slice(0, 3).map(item => ({ title: item.contact.name, meta: `消息 · ${item.contact.company}`, path: '/inbox' })),
    ]
  }, [canManageWorkspace, customers, inboxPreview.data?.items, query])

  const openPath = (path: string) => {
    navigate(path)
    setSearchOpen(false)
    setQuery('')
  }
  const menuEntry = ({ path, label, icon: Icon }: (typeof navigation)[number]): NonNullable<MenuProps['items']>[number] => ({
    key: path,
    icon: <Icon size={18}/>,
    label: path === '/inbox' ? <span className="menu-label-with-count">{label}<AntBadge count={inboxUnread} size="small"/></span> : label,
  })
  const menuItems: MenuProps['items'] = [
    { type: 'group', label: '总览', children: navigation.filter(item => item.path === '/dashboard').map(menuEntry) },
    { type: 'group', label: '客户开发', children: navigation.filter(item => ['/icp', '/radar', '/customers'].includes(item.path)).map(menuEntry) },
    { type: 'group', label: '营销触达', children: navigation.filter(item => ['/content', '/campaigns', '/inbox'].includes(item.path)).map(menuEntry) },
    { type: 'group', label: '商机与分析', children: navigation.filter(item => ['/pipeline', '/attribution'].includes(item.path)).map(menuEntry) },
    { type: 'group', label: '系统', children: [
      ...(canManageWorkspace ? [{ key: 'settings', icon: <Settings size={18}/>, label: '应用设置', children: settingsNavigation.map(menuEntry) }] : []),
      ...(canManageWorkspace ? [{ key: 'admin', icon: <ShieldCheck size={18}/>, label: '管理中心', children: adminNavigation.map(menuEntry) }] : []),
    ] },
  ]
  const navigationPanel = (compact = false, mobile = false) => <div className="sidebar-inner">
    <div className="brand"><span className="brand-mark"><Sparkles size={18}/></span>{!compact && <><span className="brand-copy"><strong>Sondara</strong><small>AI Growth System</small></span><em>OSS</em></>}</div>
    <AntMenu className="app-navigation-menu" theme="dark" mode="inline" inlineCollapsed={compact} items={menuItems} selectedKeys={[location.pathname]} defaultOpenKeys={[location.pathname.startsWith('/settings') ? 'settings' : location.pathname.startsWith('/admin') ? 'admin' : '']} onClick={({ key }) => openPath(key)}/>
    {!compact && !mobile && <div className="sidebar-footer"><Button className="collapse-button" onClick={toggleSidebar} aria-label="收起导航栏"><ChevronLeft size={15}/><span>收起导航栏</span></Button></div>}
  </div>

  const notificationContent = <div className="topbar-popover notifications">
    <header><div><strong>通知</strong><small>{unreadCount ? `${unreadCount} 条未读` : '已全部读完'}</small></div><Button className="mark-read" onClick={() => setUnreadCount(0)} disabled={!unreadCount}><CheckCheck size={14}/>全部已读</Button></header>
    {(inboxPreview.data?.items ?? []).filter(thread => thread.unreadCount > 0).slice(0, 5).map(thread => <Button className="unread" key={thread.id} onClick={() => { navigate('/inbox'); setNotificationsOpen(false); setUnreadCount(value => Math.max(0, value - 1)) }}><span><strong>{thread.subject || thread.lastMessagePreview}</strong><small>{thread.contact?.name ?? '未知联系人'} · {thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</small></span><ChevronRight size={15}/></Button>)}
    {unreadCount === 0 && <p className="topbar-search-empty">暂无未读消息</p>}
    <footer><Button onClick={() => { navigate('/inbox'); setNotificationsOpen(false) }}>查看客户消息</Button></footer>
  </div>
  const accountItems: MenuProps['items'] = [
    { key: 'profile', icon: <Settings size={15}/>, label: <span className="account-dropdown-label"><strong>个人资料</strong><small>资料、语言与偏好</small></span> },
    { key: 'security', icon: <UserRound size={15}/>, label: <span className="account-dropdown-label"><strong>登录与安全</strong><small>密码、验证与设备</small></span> },
    { type: 'divider' },
    { key: 'logout', danger: true, icon: <LogOut size={15}/>, label: '退出登录' },
  ]
  const onAccountAction: MenuProps['onClick'] = async ({ key }) => {
    setAccountOpen(false)
    if (key === 'profile') return navigate('/settings/profile')
    if (key === 'security') return navigate('/settings/security')
    if (key === 'logout') {
      try { await authApi.logout() } finally {
        for (const queryKey of [['auth-session'], ['customers'], ['tasks'], ['deals']]) queryClient.removeQueries({ queryKey })
        navigate('/login', { replace: true })
      }
    }
  }

  return <Layout className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <Sider aria-label="主导航" className="sidebar desktop-sidebar" width={248} collapsedWidth={76} collapsed={collapsed} trigger={null}>{navigationPanel(collapsed)}</Sider>
    <Drawer className="mobile-navigation-drawer" placement="left" size={280} open={mobileOpen} closable={false} onClose={() => setMobileOpen(false)}>{navigationPanel(false, true)}</Drawer>
    <Layout className="main-area">
      <Header className="topbar">
        <Button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={20}/></Button>
        {collapsed && <Button className="desktop-expand-sidebar" aria-label="展开导航栏" onClick={toggleSidebar}><ChevronRight size={16}/></Button>}
        <AutoComplete className="topbar-search-autocomplete" value={query} open={searchOpen && Boolean(query.trim())} onFocus={() => setSearchOpen(true)} onChange={value => { setQuery(value); setSearchOpen(true) }} onSelect={value => openPath(value.split('|')[0])} options={results.map((result, index) => ({ value: `${result.path}|${index}`, label: <span className="global-search-option"><strong>{result.title}</strong><small>{result.meta}</small></span> }))} notFoundContent={<span className="topbar-search-empty">暂无匹配结果</span>} filterOption={false}><Input ref={searchInputRef} prefix={<Search size={17}/>} placeholder="搜索客户、联系人和消息" allowClear/></AutoComplete>
        <div className="topbar-spacer"/>
        <Popover content={notificationContent} trigger="click" placement="bottomRight" open={notificationsOpen} onOpenChange={setNotificationsOpen}><Button className={`topbar-icon ${notificationsOpen ? 'active' : ''}`} aria-label={unreadCount ? `通知，${unreadCount} 条未读` : '通知'}><AntBadge count={unreadCount} size="small"><Bell size={19}/></AntBadge></Button></Popover>
        <span className="topbar-divider"/>
        <Dropdown trigger={['click']} placement="bottomRight" open={accountOpen} onOpenChange={setAccountOpen} menu={{ items: accountItems, onClick: onAccountAction }}><Button className={`user-block ${accountOpen ? 'active' : ''}`} aria-label={`打开账户菜单，${displayName}`}><Avatar size={34}>{avatarText}</Avatar><div className="user-copy"><strong title={displayName}>{displayName}</strong><span>{authSession.data?.workspace.role === 'owner' ? '所有者' : authSession.data?.workspace.role === 'admin' ? '管理员' : authSession.data?.workspace.role === 'viewer' ? '只读成员' : '成员'}</span></div></Button></Dropdown>
      </Header>
      <Content className="app-content"><Outlet/></Content>
    </Layout>
    <Toast/>
  </Layout>
}
