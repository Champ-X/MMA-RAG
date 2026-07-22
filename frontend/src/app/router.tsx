import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RouteErrorFallback } from './RouteErrorFallback'
import { LoadingState } from '@/components/nexus/LoadingState'
import { RunWorkspaceSkeleton } from '@/features/runs/RunWorkspaceSkeleton'

const HomePage = lazy(() => import('@/features/home/HomePage'))
const SpacesPage = lazy(() => import('@/features/spaces/SpacesPage'))
const SpaceOverviewPage = lazy(() => import('@/features/spaces/SpaceOverviewPage'))
const VerifiedKnowledgePage = lazy(() => import('@/features/spaces/VerifiedKnowledgePage'))
const CollectionsPage = lazy(() => import('@/features/spaces/CollectionsPage'))
const SourcesPage = lazy(() => import('@/features/sources/SourcesPage'))
const IngestionJobsPage = lazy(() => import('@/features/sources/IngestionJobsPage'))
const EvidenceBrowserPage = lazy(() => import('@/features/evidence/EvidenceBrowserPage'))
const EvidenceDetailPage = lazy(() => import('@/features/evidence/EvidenceDetailPage'))
const ResearchNewPage = lazy(() => import('@/features/runs/ResearchNewPage'))
const ConversationHistoryPage = lazy(() => import('@/features/runs/ConversationHistoryPage'))
const RunWorkspacePage = lazy(() => import('@/features/runs/RunWorkspacePage'))
const StudioPage = lazy(() => import('@/features/artifacts/StudioPage'))
const ArtifactPage = lazy(() => import('@/features/artifacts/ArtifactPage'))
const ModelsPage = lazy(() => import('@/features/models/ModelsPage'))
const ToolsPage = lazy(() => import('@/features/tools/ToolsPage'))
const AgentsPage = lazy(() => import('@/features/tools/AgentsPage'))
const SystemPage = lazy(() => import('@/features/system/SystemPage'))

const screen = (element: React.ReactNode) => <Suspense fallback={<LoadingState />}>{element}</Suspense>
const runScreen = (element: React.ReactNode) => <Suspense fallback={<RunWorkspaceSkeleton />}>{element}</Suspense>

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        errorElement: <RouteErrorFallback />,
        children: [
          { index: true, element: screen(<HomePage />) },
          { path: 'spaces', element: screen(<SpacesPage />) },
          { path: 'spaces/:spaceId', element: screen(<SpaceOverviewPage />) },
          { path: 'spaces/:spaceId/knowledge', element: screen(<VerifiedKnowledgePage />) },
          { path: 'spaces/:spaceId/sources', element: screen(<SourcesPage />) },
          { path: 'spaces/:spaceId/collections', element: screen(<CollectionsPage />) },
          { path: 'spaces/:spaceId/evidence', element: screen(<EvidenceBrowserPage />) },
          { path: 'spaces/:spaceId/jobs', element: screen(<IngestionJobsPage />) },
          { path: 'evidence', element: screen(<EvidenceBrowserPage />) },
          { path: 'research/new', element: screen(<ResearchNewPage />) },
          { path: 'conversations', element: screen(<ConversationHistoryPage />) },
          { path: 'runs/:runId', element: runScreen(<RunWorkspacePage />) },
          { path: 'runs/:runId/evidence/:revisionId', element: screen(<EvidenceDetailPage />) },
          { path: 'studio', element: screen(<StudioPage />) },
          { path: 'artifacts/:artifactId', element: screen(<ArtifactPage />) },
          { path: 'agents', element: screen(<AgentsPage />) },
          { path: 'tools', element: screen(<ToolsPage />) },
          { path: 'models/setup', element: screen(<ModelsPage tab="setup" />) },
          { path: 'models/providers', element: screen(<ModelsPage tab="providers" />) },
          { path: 'models/catalog', element: screen(<ModelsPage tab="catalog" />) },
          { path: 'models/routing', element: screen(<ModelsPage tab="routing" />) },
          { path: 'system/status', element: screen(<SystemPage tab="status" />) },
          { path: 'system/jobs', element: screen(<SystemPage tab="jobs" />) },
          { path: 'system/storage', element: screen(<SystemPage tab="storage" />) },
          { path: 'system/backups', element: screen(<SystemPage tab="backups" />) },
          { path: 'system/traces', element: screen(<SystemPage tab="traces" />) },
          { path: 'system/settings', element: screen(<SystemPage tab="settings" />) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])
