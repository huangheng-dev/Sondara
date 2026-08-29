import type { LucideIcon } from 'lucide-react'

export type NavItem = { label: string; path: string; icon: LucideIcon }
export type Candidate = {
  id: string
  company: string
  region: string
  industry: string
  size: string
  score: number
  signal: string
  source: string
  taskName?: string
  value: string
  confidence: number
  updatedAt: string
  reason: string
  dimensions: { label: string; score: number }[]
  evidence: { title: string; source: string; time: string; strength: '强' | '中' | '弱'; sourceUrl?: string | null }[]
  intentSignals: { id: string; signalType: string; title: string; summary: string; source: string; sourceUrl: string; scoreBoost: number; observedAt: number; expiresAt: number | null }[]
  committee: { name: string; role: string; influence: string; contact: string }[]
  contacts: { id: string; name: string; role: string; email: string | null; phone: string | null; socialUrl: string | null; sourceUrl: string; verificationStatus: 'verified' | 'public' | 'needs_review'; confidence: number }[]
  relationships: { label: string; value: string }[]
}
