import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { AntDesignProvider } from '@/app/AntDesignProvider'
import 'antd/dist/reset.css'
import '@/styles/index.css'
import '@/styles/admin.css'
import '@/styles/antd.css'
import '@/styles/layout-system.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(<StrictMode><AntDesignProvider><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></AntDesignProvider></StrictMode>)
