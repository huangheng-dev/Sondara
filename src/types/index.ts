import type { LucideIcon } from 'lucide-react'

export type NavItem = { label: string; path: string; icon: LucideIcon }
export type Metric = { label: string; value: string; change: string; tone?: 'green' | 'orange' | 'blue' }
export type Candidate = {
  id: string
  company: string
  region: string
  industry: string
  size: string
  score: number
  signal: string
  source: string
  value: string
  confidence: number
  updatedAt: string
  reason: string
  dimensions: { label: string; score: number }[]
  evidence: { title: string; source: string; time: string; strength: '强' | '中' | '弱' }[]
  committee: { name: string; role: string; influence: string; contact: string }[]
  contacts: { id: string; name: string; role: string; email: string | null; phone: string | null; socialUrl: string | null; sourceUrl: string; verificationStatus: 'verified' | 'public' | 'needs_review'; confidence: number }[]
  relationships: { label: string; value: string }[]
}
