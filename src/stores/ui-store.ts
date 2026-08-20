import { create } from 'zustand'

type UiState = {
  collapsed: boolean
  toast: string | null
  toggleSidebar: () => void
  showToast: (message: string) => void
  clearToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  toast: null,
  toggleSidebar: () => set((state) => ({ collapsed: !state.collapsed })),
  showToast: (message) => set({ toast: message }),
  clearToast: () => set({ toast: null }),
}))
