import { describe, expect, it } from 'vitest'

describe('route error boundary contract', () => {
  it('keeps branded route error boundaries without removing the AppShell recovery surface', () => {
    const files = import.meta.glob<string>(['../app/router.tsx', '../app/RouteErrorFallback.tsx'], {
      eager: true,
      import: 'default',
      query: '?raw',
    })
    const router = files['../app/router.tsx']
    const fallback = files['../app/RouteErrorFallback.tsx']

    expect(router).toContain("import { RouteErrorFallback } from './RouteErrorFallback'")
    expect(router.match(/errorElement: <RouteErrorFallback \/>/g)?.length).toBeGreaterThanOrEqual(2)
    expect(router).toContain('element: <AppShell />,\n    errorElement: <RouteErrorFallback />,\n    children: [\n      {\n        errorElement: <RouteErrorFallback />,')
    expect(router.indexOf('element: <AppShell />')).toBeLessThan(router.indexOf("path: 'runs/:runId'"))
    expect(fallback).toContain('useRouteError')
    expect(fallback).toContain('role="alert"')
    expect(fallback).toContain('aria-describedby={`${routeErrorDetailId} ${routeErrorStatusId}`}')
    expect(fallback).toContain('onReload = reloadCurrentRoute')
    expect(fallback).toContain('onClick={onReload}')
    expect(fallback).toContain('window.location.reload()')
    expect(fallback).not.toContain('onClick={() => window.location.reload()}')
  })
})
