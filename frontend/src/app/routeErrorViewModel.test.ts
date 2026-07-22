import { describe, expect, it } from 'vitest'
import { buildRouteErrorViewModel } from './routeErrorViewModel'

describe('buildRouteErrorViewModel', () => {
  it('explains unknown render failures without exposing a stack trace', () => {
    expect(buildRouteErrorViewModel(new Error('Chunk failed to load'))).toMatchObject({
      detail: 'Chunk failed to load',
      statusLabel: 'Client error',
      title: 'Nexus hit a recoverable interface fault',
    })
  })

  it('normalizes route response errors with nested API messages', () => {
    expect(buildRouteErrorViewModel({
      data: { error: { message: 'Run no longer exists.' } },
      internal: false,
      status: 410,
      statusText: 'Gone',
    })).toMatchObject({
      detail: 'Run no longer exists.',
      statusLabel: '410',
      title: 'Nexus could not open this workspace',
    })
  })

  it('gives missing routes a direct recovery copy', () => {
    expect(buildRouteErrorViewModel({
      data: 'No route matches URL "/missing"',
      internal: false,
      status: 404,
      statusText: 'Not Found',
    })).toMatchObject({
      detail: 'No route matches URL "/missing"',
      statusLabel: '404',
      title: 'This page is not available',
    })
  })
})
