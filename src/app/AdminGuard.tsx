import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { authApi } from '@/lib/api'

export function AdminGuard({ children }: { children: ReactNode }) {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })
  if (session.isPending) return null
  if (!session.data || !['owner', 'admin'].includes(session.data.workspace.role)) return <Navigate to="/dashboard" replace />
  return children
}
