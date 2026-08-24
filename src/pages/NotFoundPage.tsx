import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Result } from 'antd'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="result-page"><Result status="404" title="页面不存在" subTitle="您访问的页面可能已移动或不存在。" extra={<Button variant="primary" onClick={() => navigate('/dashboard')}>返回工作台</Button>}/></div>
  )
}
