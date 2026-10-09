import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { isAxiosError } from 'axios'
import { systemApi } from '@/services/api_client'
import { createModelRouteTests } from '@/lib/modelRouteTests'
import type { ModelRouteSelection, ModelRouteTestResponse } from '@/types/modelRouteTest'

async function probeRoute(route: ModelRouteSelection): Promise<ModelRouteTestResponse> {
  const started = performance.now()
  try {
    return await systemApi.testModelRoute(route)
  } catch (error) {
    const timedOut = isAxiosError(error) && error.code === 'ECONNABORTED'
    const detail = isAxiosError(error) && typeof error.response?.data?.detail === 'string' ? error.response.data.detail : null
    return {
      ...route, success: false, duration_ms: performance.now() - started,
      error_code: timedOut ? 'timeout' : 'network_error',
      message: timedOut ? '连接测试超时，请稍后重试。' : detail ?? '无法完成连接测试，请检查后端连接后重试。',
    }
  }
}

export function useModelRouteTests(selections: ModelRouteSelection[]) {
  const controllerRef = useRef<ReturnType<typeof createModelRouteTests> | null>(null)
  if (!controllerRef.current) controllerRef.current = createModelRouteTests(probeRoute)
  const controller = controllerRef.current
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useLayoutEffect(() => { controller.setSelections(selections) }, [controller, selections])
  useEffect(() => () => { controller.clear() }, [controller])
  return { ...snapshot, test: controller.test, testAll: controller.testAll, stopQueued: controller.stopQueued }
}
