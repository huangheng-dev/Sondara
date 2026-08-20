import { useEffect } from 'react'
import { App } from 'antd'
import { useUiStore } from '@/stores/ui-store'

export function Toast() {
  const { message } = App.useApp()
  const { toast, clearToast } = useUiStore()
  useEffect(() => {
    if (!toast) return
    void message.open({ key: 'sondara-global-message', type: 'success', content: toast, duration: 2.4 })
    const timer = window.setTimeout(clearToast, 2400)
    return () => window.clearTimeout(timer)
  }, [toast, clearToast, message])
  return null
}
