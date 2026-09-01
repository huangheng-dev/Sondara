const VERSION_ENDPOINT = '/version.json'
const VERSION_CHECK_INTERVAL_MS = 30_000
const REFRESH_GUARD_MS = 15_000
const BUILD_QUERY_KEY = '__sondara_build'
const RECOVERY_QUERY_KEY = '__sondara_recover'
const LAST_BUILD_REFRESH_KEY = 'sondara:last-build-refresh'
const LAST_RECOVERY_REFRESH_KEY = 'sondara:last-recovery-refresh'

type BuildVersion = {
  buildId?: string
}

const removeInternalRefreshParameters = () => {
  const currentUrl = new URL(window.location.href)
  if (!currentUrl.searchParams.has(BUILD_QUERY_KEY) && !currentUrl.searchParams.has(RECOVERY_QUERY_KEY)) return

  currentUrl.searchParams.delete(BUILD_QUERY_KEY)
  currentUrl.searchParams.delete(RECOVERY_QUERY_KEY)
  window.history.replaceState(window.history.state, '', currentUrl)
}

const replaceWithCacheBuster = (key: string, value: string) => {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set(key, value)
  window.location.replace(nextUrl)
}

const refreshForNewBuild = (buildId: string) => {
  const refreshMarker = `${buildId}:${Date.now()}`
  const previousMarker = window.sessionStorage.getItem(LAST_BUILD_REFRESH_KEY)
  if (previousMarker?.startsWith(`${buildId}:`)) {
    const previousTime = Number(previousMarker.slice(buildId.length + 1))
    if (Date.now() - previousTime < REFRESH_GUARD_MS) return
  }

  window.sessionStorage.setItem(LAST_BUILD_REFRESH_KEY, refreshMarker)
  replaceWithCacheBuster(BUILD_QUERY_KEY, buildId)
}

const recoverFromStaleChunk = () => {
  const now = Date.now()
  const previousTime = Number(window.sessionStorage.getItem(LAST_RECOVERY_REFRESH_KEY) ?? 0)
  if (now - previousTime < REFRESH_GUARD_MS) return

  window.sessionStorage.setItem(LAST_RECOVERY_REFRESH_KEY, String(now))
  replaceWithCacheBuster(RECOVERY_QUERY_KEY, String(now))
}

const checkBuildVersion = async () => {
  try {
    const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return

    const version = await response.json() as BuildVersion
    if (version.buildId && version.buildId !== __APP_BUILD_ID__) {
      refreshForNewBuild(version.buildId)
    }
  } catch {
    // A temporary network interruption should not disrupt the current session.
  }
}

const isStaleChunkError = (reason: unknown) => {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
  return /dynamically imported module|importing a module script failed|failed to fetch module script/i.test(message)
}

export const startBuildVersionGuard = () => {
  if (import.meta.env.DEV) return

  removeInternalRefreshParameters()
  void checkBuildVersion()

  window.setInterval(() => void checkBuildVersion(), VERSION_CHECK_INTERVAL_MS)
  window.addEventListener('focus', () => void checkBuildVersion())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkBuildVersion()
  })
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    recoverFromStaleChunk()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (!isStaleChunkError(event.reason)) return
    event.preventDefault()
    recoverFromStaleChunk()
  })
}
