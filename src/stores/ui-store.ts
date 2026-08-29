import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UiState = {
  collapsed: boolean
  toast: string | null
  toggleSidebar: () => void
  showToast: (message: string) => void
  clearToast: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      collapsed: false,
      toast: null,
      toggleSidebar: () => set((state) => ({ collapsed: !state.collapsed })),
      showToast: (message) => set({ toast: message }),
      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'sondara-ui-preferences',
      version: 1,
      partialize: (state) => ({ collapsed: state.collapsed }),
    },
  ),
)
