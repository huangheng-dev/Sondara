import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AutoComplete, Avatar, Badge as AntBadge, Drawer, Dropdown, Flex, Grid, Input, Layout, Menu as AntMenu, Popover, Space, Typography, type InputRef, type MenuProps } from 'antd'
import { Bell, CheckCheck, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { adminNavigation, navigation, settingsNavigation } from '@/app/navigation'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { authApi, automationApi, customerApi, inboxApi } from '@/lib/api'
import { useBusinessStore } from '@/stores/business-store'
import { useUiStore } from '@/stores/ui-store'

const { Header, Content, Sider } = Layout

export function AppLayout() {
  const { collapsed, toggleSidebar } = useUiStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<InputRef>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const activeMenuGroup = location.pathname.startsWith('/settings') ? 'settings' : location.pathname.startsWith('/admin') ? 'admin' : ''
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>(collapsed || !activeMenuGroup ? [] : [activeMenuGroup])
  const queryClient = useQueryClient()
  const customers = useBusinessStore(state => state.customers)
  const accountPreferences = useBusinessStore(state => state.accountPreferences)
  const authSession = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })
  const canManageWorkspace = ['owner', 'admin'].includes(authSession.data?.workspace.role ?? '')
  const customerSearch = useQuery({
    queryKey: ['customers', authSession.data?.workspace.id, 'global-search'],
    queryFn: () => customerApi.list({ pageSize: 100, sort: 'updated_desc' }),
    enabled: Boolean(authSession.data?.workspace.id),
    retry: 1,
  })
  const inboxPreview = useQuery({ queryKey: ['inbox-threads', 'shell-preview'], queryFn: () => inboxApi.listThreads({ limit: 50 }), retry: 1 })
  const notificationQuery = useQuery({ queryKey: ['workspace-notifications'], queryFn: automationApi.notifications, retry: 1, refetchInterval: 30_000 })
  const inboxUnread = inboxPreview.data?.unreadTotal ?? 0
  const unreadCount = notificationQuery.data?.unreadTotal ?? 0
  const displayName = accountPreferences?.displayName?.trim() || authSession.data?.user.displayName?.trim() || '我的账户'
  const avatarText = displayName.slice(0, 1)
  const screens = Grid.useBreakpoint()
  const isDesktop = screens.lg !== false

  useEffect(() => {
    setOpenMenuKeys(collapsed || !activeMenuGroup ? [] : [activeMenuGroup])
  }, [activeMenuGroup, collapsed])
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
      ...(customerSearch.data?.items ?? customers).filter(item => `${item.company}${item.region}${item.industry}${item.signal}`.toLowerCase().includes(keyword)).slice(0, 4).map(item => ({ title: item.company, meta: `客户 · ${item.region} · 匹配度 ${item.score}`, path: `/customers?open=${encodeURIComponent(item.id)}` })),
      ...(inboxPreview.data?.items ?? []).filter(item => `${item.contact.name}${item.contact.company}${item.lastMessagePreview}${item.channel}`.toLowerCase().includes(keyword)).slice(0, 3).map(item => ({ title: item.contact.name, meta: `消息 · ${item.contact.company}`, path: '/inbox' })),
    ]
  }, [canManageWorkspace, customerSearch.data?.items, customers, inboxPreview.data?.items, query])

  const openPath = (path: string) => {
    navigate(path)
    setSearchOpen(false)
    setQuery('')
  }
  const handleMenuOpenChange: MenuProps['onOpenChange'] = keys => {
    const latestKey = keys.find(key => !openMenuKeys.includes(key))
    setOpenMenuKeys(latestKey ? [latestKey] : [])
  }
  const menuEntry = ({ path, label, icon: Icon }: (typeof navigation)[number]): NonNullable<MenuProps['items']>[number] => ({
    key: path,
    icon: <Icon size={18}/>,
    label: path === '/inbox' ? <Flex justify="space-between">{label}<AntBadge count={inboxUnread} size="small"/></Flex> : label,
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
  const navigationPanel = (compact = false) => <Flex className="app-navigation" vertical style={{ height: '100%' }}>
    <Flex className="app-brand" align="center" gap={11} style={{ paddingInline: compact ? 17 : 18 }}>
      <BrandMark className="app-brand__mark" size={38} />
      {!compact && <><Flex className="app-brand__copy" vertical gap={2}><Typography.Text strong>Sondara</Typography.Text><Typography.Text>AI Growth System</Typography.Text></Flex><Typography.Text className="app-brand__badge">OSS</Typography.Text></>}
    </Flex>
    <AntMenu className="app-menu" theme="dark" mode="inline" inlineCollapsed={compact} items={menuItems} selectedKeys={[location.pathname]} openKeys={openMenuKeys} subMenuCloseDelay={0.15} onOpenChange={handleMenuOpenChange} onClick={({ key }) => openPath(key)} style={{ flex: 1, overflowY: 'auto' }}/>
  </Flex>

  const notificationContent = <Space className="notification-panel" orientation="vertical" style={{ width: 360 }}>
    <Flex align="center" justify="space-between"><Space orientation="vertical" size={0}><Typography.Text strong>通知</Typography.Text><Typography.Text type="secondary">{unreadCount ? `${unreadCount} 条未读` : '已全部读完'}</Typography.Text></Space><Button onClick={async() => { await automationApi.readAllNotifications(); await notificationQuery.refetch() }} disabled={!unreadCount}><CheckCheck size={14}/>全部已读</Button></Flex>
    {(notificationQuery.data?.items ?? []).slice(0, 8).map(item => <Button block key={item.id} onClick={async() => { if(!item.readAt) await automationApi.readNotification(item.id); await notificationQuery.refetch(); navigate(item.actionPath || '/dashboard'); setNotificationsOpen(false) }}><Space orientation="vertical" size={0} style={{minWidth:0,flex:1,textAlign:'left'}}><Typography.Text strong={!item.readAt} ellipsis>{item.title}</Typography.Text><Typography.Text type="secondary" ellipsis>{item.description}</Typography.Text></Space><ChevronRight size={15}/></Button>)}
    {unreadCount === 0 && <Typography.Text type="secondary">暂无未读消息</Typography.Text>}
    <Button block type="link" onClick={() => { navigate('/dashboard'); setNotificationsOpen(false) }}>查看行动清单</Button>
  </Space>
  const accountItems: MenuProps['items'] = [
    { key: 'profile', icon: <Settings size={15}/>, label: '个人资料' },
    { key: 'security', icon: <UserRound size={15}/>, label: '登录与安全' },
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

  return <Layout className="app-shell" hasSider style={{ minHeight: '100vh' }}>
    {isDesktop && <Sider className="app-sidebar" aria-label="主导航" width={248} collapsedWidth={72} collapsed={collapsed} trigger={null}>{navigationPanel(collapsed)}</Sider>}
    <Drawer className="app-mobile-nav" placement="left" size={280} open={mobileOpen} closable onClose={() => setMobileOpen(false)} styles={{ body: { padding: 0 } }}>{navigationPanel(false)}</Drawer>
    <Layout>
      <Header className="app-topbar" style={{ paddingInline: isDesktop ? 28 : 16 }}>
        <Flex className="app-topbar__start" align="center" gap={10}>
          {isDesktop ? <Button className="shell-action" onClick={toggleSidebar} aria-label={collapsed ? '展开导航栏' : '收起导航栏'} title={collapsed ? '展开导航栏' : '收起导航栏'}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</Button> : <Button className="shell-action" onClick={() => setMobileOpen(true)} aria-label="打开导航" title="打开导航"><Menu size={20}/></Button>}
          <AutoComplete className="app-search" value={query} open={searchOpen && Boolean(query.trim())} onFocus={() => setSearchOpen(true)} onChange={value => { setQuery(value); setSearchOpen(true) }} onSelect={value => openPath(value.split('|')[0])} options={results.map((result, index) => ({ value: `${result.path}|${index}`, label: <Space orientation="vertical" size={0}><Typography.Text strong>{result.title}</Typography.Text><Typography.Text type="secondary">{result.meta}</Typography.Text></Space> }))} notFoundContent={<Typography.Text type="secondary">暂无匹配结果</Typography.Text>} filterOption={false}><Input ref={searchInputRef} prefix={<Search size={17}/>} placeholder="搜索客户、联系人和消息" allowClear suffix={isDesktop ? <Typography.Text className="search-shortcut">Ctrl K</Typography.Text> : undefined}/></AutoComplete>
        </Flex>
        <Flex className="app-topbar__end" align="center" gap={10}>
          <Popover content={notificationContent} trigger="click" placement="bottomRight" open={notificationsOpen} onOpenChange={setNotificationsOpen}><Button className="shell-action" aria-label={unreadCount ? `通知，${unreadCount} 条未读` : '通知'}><AntBadge count={unreadCount} size="small"><Bell size={19}/></AntBadge></Button></Popover>
          <Dropdown trigger={['click']} placement="bottomRight" open={accountOpen} onOpenChange={setAccountOpen} menu={{ items: accountItems, onClick: onAccountAction }}><Button className="shell-account" aria-label={`打开账户菜单，${displayName}`}><Avatar size={24}>{avatarText}</Avatar>{isDesktop && displayName}</Button></Dropdown>
        </Flex>
      </Header>
      <Content className="app-content" style={{ minWidth: 0, padding: isDesktop ? '28px 30px 40px' : '20px 16px 32px' }}><Outlet/></Content>
    </Layout>
    <Toast/>
  </Layout>
}
