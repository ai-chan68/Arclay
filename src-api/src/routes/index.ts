import { Hono } from 'hono'
import { healthRoutes } from './health'
import { agentRoutes } from './agent'
import { createAgentNewRoutes, type AgentRouteDeps } from './agent-new'
import { sandboxRoutes } from './sandbox'
import { createSettingsRoutes, type SettingsRouteDeps } from './settings'
import { multiAgentRoutes } from './multi-agent' // @experimental - not integrated with frontend
import { providersRoutes } from './providers'
import previewRoutes from './preview'
import { filesRoutes } from './files'
import { createScheduledTaskRoutes, type ScheduledTaskRouteDeps } from './scheduled-tasks'
import knowledgeNotesRoutes from './knowledge-notes'

export interface RouteFactoriesDeps {
  agentNew: AgentRouteDeps
  settings: SettingsRouteDeps
  scheduledTasks: ScheduledTaskRouteDeps
}

export function createRoutes(deps: RouteFactoriesDeps): Hono {
  assertRouteFactoriesDeps(deps)
  const routes = new Hono()

  routes.route('/health', healthRoutes)
  routes.route('/agent', agentRoutes) // Legacy endpoints: sunset, return 410 with migration hints
  routes.route('/v2/agent', createAgentNewRoutes(deps.agentNew)) // New two-phase execution API
  routes.route('/sandbox', sandboxRoutes)
  routes.route('/settings', createSettingsRoutes(deps.settings))
  routes.route('/agent/multi', multiAgentRoutes) // @experimental
  routes.route('/providers', providersRoutes)
  routes.route('/preview', previewRoutes)
  routes.route('/files', filesRoutes)
  routes.route('/scheduled-tasks', createScheduledTaskRoutes(deps.scheduledTasks))
  routes.route('/', knowledgeNotesRoutes) // Knowledge notes API

  return routes
}

function assertRouteFactoriesDeps(deps: RouteFactoriesDeps | undefined): asserts deps is RouteFactoriesDeps {
  if (!deps?.agentNew || !deps?.settings || !deps?.scheduledTasks) {
    throw new Error('createRoutes requires explicit route deps for agentNew, settings, and scheduledTasks')
  }
}
