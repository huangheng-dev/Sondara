import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileQuestion } from 'lucide-react'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="page-content not-found-page">
      <EmptyState
        icon={FileQuestion}
        title="页面不存在"
        description="您访问的页面可能已移动或不存在。"
        action={<Button variant="primary" onClick={() => navigate('/dashboard')}>返回工作台</Button>}
      />
    </div>
  )
}
