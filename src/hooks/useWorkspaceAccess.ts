import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/lib/api'

export function useWorkspaceAccess() {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })
  const role = session.data?.workspace.role
  return {
    role,
    canWrite: Boolean(role && role !== 'viewer'),
    canDelete: role === 'owner' || role === 'admin',
    canManageSettings: role === 'owner' || role === 'admin',
  }
}
