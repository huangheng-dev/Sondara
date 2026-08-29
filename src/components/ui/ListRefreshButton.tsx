import type { ComponentProps } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'

type ListRefreshButtonProps = Omit<ComponentProps<typeof Button>, 'icon' | 'size'> & {
  label: string
}

export function ListRefreshButton({ label, ...props }: ListRefreshButtonProps) {
  return <Button {...props} size="md" icon={<RefreshCw size={16} />}>{label}</Button>
}
