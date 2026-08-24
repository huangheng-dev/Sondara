import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { Result } from 'antd'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ApiError, authApi } from '@/lib/api'
import { useBusinessStore } from '@/stores/business-store'

export function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  const updateAccountPreferences = useBusinessStore(state => state.updateAccountPreferences)
  const session = useQuery({
    queryKey: ['auth-session'],
    queryFn: authApi.session,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!session.data) return
    const current = useBusinessStore.getState().accountPreferences
    updateAccountPreferences({
      ...current,
      displayName: session.data.user.displayName,
      email: session.data.user.email,
      businessName: session.data.workspace.name,
    })
  }, [session.data, updateAccountPreferences])

  if (session.isPending) {
    return null
  }

  if (session.error instanceof ApiError && session.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (session.isError) {
    return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f7fb' }}><Result
      icon={<ShieldCheck size={48} strokeWidth={1.7} color="#175cd3" />}
      title="暂时无法连接服务"
      subTitle="请确认 API 服务已启动，然后重试。"
      extra={<Button type="primary" onClick={() => session.refetch()}>重新连接</Button>}
    /></main>
  }

  return children
}
