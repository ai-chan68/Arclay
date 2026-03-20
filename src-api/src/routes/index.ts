import { Hono } from 'hono'
import { healthRoutes } from './health'
import { agentRoutes } from './agent'
import { agentNewRoutes } from './agent-new'
import { sandboxRoutes } from './sandbox'
import { settingsRoutes } from './settings'
import { multiAgentRoutes } from './multi-agent' // @experimental - not integrated with frontend
import { providersRoutes } from './providers'
import previewRoutes from './preview'
import { filesRoutes } from './files'
import { scheduledTaskRoutes } from './scheduled-tasks'

const routes = new Hono()

routes.route('/health', healthRoutes)
routes.route('/agent', agentRoutes) // Legacy endpoints: sunset, return 410 with migration hints
routes.route('/v2/agent', agentNewRoutes) // New two-phase execution API
routes.route('/sandbox', sandboxRoutes)
routes.route('/settings', settingsRoutes)
routes.route('/agent/multi', multiAgentRoutes) // @experimental
routes.route('/providers', providersRoutes)
routes.route('/preview', previewRoutes)
routes.route('/files', filesRoutes)
routes.route('/scheduled-tasks', scheduledTaskRoutes)

export { routes }
