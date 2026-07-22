import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Tools and agents CSS loading boundaries', () => {
  it('keeps registry card styles with their lazy tools routes', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/tools/ToolsPage.tsx',
        '../features/tools/AgentsPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const toolsPage = files['../features/tools/ToolsPage.tsx']
    const agentsPage = files['../features/tools/AgentsPage.tsx']
    const toolsCss = readFileSync(new URL('../features/tools/ToolsPage.css', import.meta.url), 'utf8')
    const agentsCss = readFileSync(new URL('../features/tools/AgentsPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const ToolsPage = lazy(() => import('@/features/tools/ToolsPage'))")
    expect(router).toContain("const AgentsPage = lazy(() => import('@/features/tools/AgentsPage'))")
    expect(toolsPage).toContain("import './ToolsPage.css'")
    expect(agentsPage).toContain("import './AgentsPage.css'")
    expect(toolsCss).toContain('.tool-grid')
    expect(toolsCss).toContain('.tool-card')
    expect(toolsCss).toContain('@media (max-width: 1180px)')
    expect(toolsCss).toContain('@media (max-width: 820px)')
    expect(agentsCss).toContain('.agent-grid')
    expect(agentsCss).toContain('.agent-card')
    expect(agentsCss).toContain('.agent-section')
    expect(agentsCss).toContain('.tag-row')
    expect(agentsCss).toContain('.policy-row')
    expect(agentsCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.tool-grid')
    expect(entryCss).not.toContain('.tool-card')
    expect(entryCss).not.toContain('.agent-grid')
    expect(entryCss).not.toContain('.agent-card')
    expect(entryCss).not.toContain('.agent-section')
    expect(entryCss).not.toContain('.tag-row')
    expect(entryCss).not.toContain('.capability-row')
    expect(entryCss).not.toContain('.policy-row')
  })
})
