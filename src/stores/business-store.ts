import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type CustomerRecord = {
  id: string
  company: string
  region: string
  industry: string
  score: number
  confidence: number
  signal: string
  source: string
  value: string
  size: string
  stage: string
  contacts: number
  valid: number
  interaction: string
  next: string
  due: string
  owner: string
  ownerUserId: string | null
  tags: string[]
}

export type DealRecord = {
  id: string
  company: string
  stage: string
  value: string
  owner: string
  next: string
  close: string
  risk: string
  age: number
  source?: string
}

export type AccountPreferences = {
  displayName: string
  email: string
  language: string
  timezone: string
  currency: string
  businessName: string
}

type BusinessState = {
  // Mirrored from API for AppLayout global search
  customers: CustomerRecord[]
  // User profile preferences synced from auth session
  accountPreferences: AccountPreferences
  // Actions
  replaceCustomers: (customers: CustomerRecord[]) => void
  updateAccountPreferences: (preferences: AccountPreferences) => void
}

const defaultAccountPreferences: AccountPreferences = {
  displayName: '',
  email: '',
  language: '简体中文',
  timezone: 'Asia/Shanghai (UTC+8)',
  currency: 'CNY · 人民币',
  businessName: '',
}

export const useBusinessStore = create<BusinessState>()(persist((set) => ({
  customers: [],
  accountPreferences: defaultAccountPreferences,
  replaceCustomers: (customers) => set({ customers }),
  updateAccountPreferences: (accountPreferences) => set({ accountPreferences }),
}), {
  name: 'sondara-business-v2',
  storage: createJSONStorage(() => localStorage),
  version: 2,
  partialize: (state) => ({
    accountPreferences: state.accountPreferences,
  }),
  merge: (persisted, current) => {
    const saved = (persisted as Partial<BusinessState> | undefined)?.accountPreferences
    return {
      ...current,
      ...(persisted as Partial<BusinessState> | undefined),
      accountPreferences: { ...defaultAccountPreferences, ...saved },
    }
  },
}))
