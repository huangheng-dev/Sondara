import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

export function NotFoundPage() {
  return (
    <div className="not-found-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem', textAlign: 'center' }}>
      <p style={{ fontSize: '4rem', fontWeight: 700, color: 'var(--color-primary, #0b5cff)', margin: 0 }}>404</p>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>页面不存在</h1>
      <p style={{ color: 'var(--color-text-secondary, #667085)', margin: 0 }}>您访问的页面可能已移动或不存在。</p>
      <Link to="/dashboard"><Button variant="primary">返回工作台</Button></Link>
    </div>
  )
}
