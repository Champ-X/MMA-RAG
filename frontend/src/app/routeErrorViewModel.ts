import { isRouteErrorResponse } from 'react-router-dom'

export type RouteErrorViewModel = {
  detail: string
  eyebrow: string
  homeHref: string
  primaryActionLabel: string
  reloadLabel: string
  statusLabel: string
  title: string
}

function messageFromData(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) return data
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const nestedError = record.error
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  return null
}

export function buildRouteErrorViewModel(error: unknown): RouteErrorViewModel {
  if (isRouteErrorResponse(error)) {
    const detail = messageFromData(error.data)
    if (error.status === 404) {
      return {
        detail: detail ?? 'This route is not part of the current Nexus workspace.',
        eyebrow: 'Route recovery',
        homeHref: '/',
        primaryActionLabel: 'Return home',
        reloadLabel: 'Reload this route',
        statusLabel: '404',
        title: 'This page is not available',
      }
    }
    return {
      detail: detail ?? (error.statusText || 'The route could not finish loading.'),
      eyebrow: 'Route recovery',
      homeHref: '/',
      primaryActionLabel: 'Return home',
      reloadLabel: 'Reload this route',
      statusLabel: String(error.status),
      title: 'Nexus could not open this workspace',
    }
  }

  const detail = error instanceof Error && error.message.trim()
    ? error.message
    : 'A route module or render path failed before Nexus could finish drawing the workspace.'

  return {
    detail,
    eyebrow: 'Route recovery',
    homeHref: '/',
    primaryActionLabel: 'Return home',
    reloadLabel: 'Reload this route',
    statusLabel: 'Client error',
    title: 'Nexus hit a recoverable interface fault',
  }
}
