import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { ApiError, authApi } from '@/lib/api'
import { useBusinessStore } from '@/stores/business-store'
import { Button } from '@/components/ui/Button'

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
    return <main className="session-gate" aria-busy="true"><i><ShieldCheck /></i><strong>正在恢复工作空间</strong><span>正在验证账户和数据权限…</span></main>
  }

  if (session.error instanceof ApiError && session.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (session.isError) {
    return <main className="session-gate session-gate-error"><i><ShieldCheck /></i><strong>暂时无法连接服务</strong><span>请确认 API 服务已启动，然后重试。</span><Button onClick={() => session.refetch()}>重新连接</Button></main>
  }

  return children
}
