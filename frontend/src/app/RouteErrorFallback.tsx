import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Link, useRouteError } from 'react-router-dom'
import { buildRouteErrorViewModel, type RouteErrorViewModel } from './routeErrorViewModel'

const routeErrorTitleId = 'route-error-title'
const routeErrorDetailId = 'route-error-detail'
const routeErrorStatusId = 'route-error-status'

function reloadCurrentRoute() {
  window.location.reload()
}

export function RouteErrorFallbackContent({
  model,
  onReload = reloadCurrentRoute,
}: {
  model: RouteErrorViewModel
  onReload?: () => void
}) {
  return (
    <div className="page-shell route-error-page">
      <section
        className="route-error-card"
        role="alert"
        aria-labelledby={routeErrorTitleId}
        aria-describedby={`${routeErrorDetailId} ${routeErrorStatusId}`}
      >
        <span className="route-error-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
        <div>
          <p className="eyebrow">{model.eyebrow}</p>
          <h1 id={routeErrorTitleId}>{model.title}</h1>
          <p id={routeErrorDetailId}>{model.detail}</p>
          <code id={routeErrorStatusId}>{model.statusLabel}</code>
        </div>
        <footer>
          <Link className="button primary" to={model.homeHref}><Home size={15} />{model.primaryActionLabel}</Link>
          <button type="button" className="button" onClick={onReload}><RotateCcw size={15} />{model.reloadLabel}</button>
        </footer>
      </section>
    </div>
  )
}

export function RouteErrorFallback() {
  const routeError = useRouteError()
  return <RouteErrorFallbackContent model={buildRouteErrorViewModel(routeError)} />
}
