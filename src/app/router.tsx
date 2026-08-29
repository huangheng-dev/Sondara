import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthGuard } from '@/app/AuthGuard'
import { AdminGuard } from '@/app/AdminGuard'
import { SettingsGuard } from '@/app/SettingsGuard'
import { PageLoader } from '@/components/ui/PageLoader'

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const AppLayout = lazy(() => import('@/app/layouts/AppLayout').then(m => ({ default: m.AppLayout })))
const RadarPage = lazy(() => import('@/pages/radar/RadarPage').then(m => ({ default: m.RadarPage })))
const CustomersPage = lazy(() => import('@/pages/customers/CustomersPage').then(m => ({ default: m.CustomersPage })))
const CampaignsPage = lazy(() => import('@/pages/campaigns/CampaignsPage').then(m => ({ default: m.CampaignsPage })))
const InboxPage = lazy(() => import('@/pages/inbox/InboxPage').then(m => ({ default: m.InboxPage })))
const PipelinePage = lazy(() => import('@/pages/pipeline/PipelinePage').then(m => ({ default: m.PipelinePage })))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const ContentPage = lazy(() => import('@/pages/content/ContentPage').then(m => ({ default: m.ContentPage })))
const IcpPage = lazy(() => import('@/pages/icp/IcpPage').then(m => ({ default: m.IcpPage })))
const AttributionPage = lazy(() => import('@/pages/attribution/AttributionPage').then(m => ({ default: m.AttributionPage })))
const AuthPage = lazy(() => import('@/pages/auth/AuthPage').then(m => ({ default: m.AuthPage })))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then(m => ({ default: m.AdminPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))

const withSuspense = (el: React.ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>

export const router = createBrowserRouter([
  { path: '/login', element: withSuspense(<AuthPage mode="login" />) },
  { path: '/register', element: withSuspense(<AuthPage mode="register" />) },
  { path: '/forgot-password', element: withSuspense(<AuthPage mode="forgot" />) },
  { path: '/reset-password', element: withSuspense(<AuthPage mode="reset" />) },
  {
  path: '/', element: <AuthGuard>{withSuspense(<AppLayout />)}</AuthGuard>, children: [
    { index: true, element: <Navigate to="/dashboard" replace /> },
    { path: 'dashboard', element: withSuspense(<DashboardPage />) },
    { path: 'icp', element: withSuspense(<IcpPage />) },
    { path: 'knowledge', element: <Navigate to="/icp" replace /> },
    { path: 'radar', element: withSuspense(<RadarPage />) },
    { path: 'procurement', element: <Navigate to="/radar" replace /> },
    { path: 'customers', element: withSuspense(<CustomersPage />) },
    { path: 'content', element: withSuspense(<ContentPage />) },
    { path: 'content/assets', element: <Navigate to="/content" replace /> },
    { path: 'campaigns', element: withSuspense(<CampaignsPage />) },
    { path: 'inbox', element: withSuspense(<InboxPage />) },
    { path: 'pipeline', element: withSuspense(<PipelinePage />) },
    { path: 'attribution', element: withSuspense(<AttributionPage />) },
    { path: 'settings', element: <Navigate to="/settings/ai" replace /> },
    { path: 'settings/lead-sources', element: <Navigate to="/settings/integrations#lead-source-settings" replace /> },
    { path: 'settings/connectors', element: <Navigate to="/settings/integrations#external-service-settings" replace /> },
    { path: 'settings/:section', element: <SettingsGuard>{withSuspense(<SettingsPage />)}</SettingsGuard> },
    { path: 'admin', element: <Navigate to="/admin/users" replace /> },
    { path: 'admin/system', element: <Navigate to="/admin/users" replace /> },
    { path: 'admin/:section', element: <AdminGuard>{withSuspense(<AdminPage />)}</AdminGuard> },
    { path: '*', element: withSuspense(<NotFoundPage />) },
  ]},
  { path: '*', element: withSuspense(<NotFoundPage />) },
])
