import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { authApi } from '@/lib/api'

const personalSections = new Set(['profile', 'security'])

export function SettingsGuard({ children }: { children: ReactNode }) {
  const { section = '' } = useParams()
  const session = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })
  if (personalSections.has(section)) return children
  if (session.isPending) return null
  if (!session.data || !['owner', 'admin'].includes(session.data.workspace.role)) return <Navigate to="/dashboard" replace />
  return children
}
