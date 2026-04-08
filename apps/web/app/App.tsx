import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AppInitializer } from '../components/layout'
import { UIThemeProvider } from '@/shared/theme/ui-theme'
import { SidebarProvider } from '@/components/task-detail/SidebarContext'
import { WorkspaceProvider } from '@/shared/workspace/workspace-store'

export function App() {
  return (
    <UIThemeProvider>
      <AppInitializer>
        <WorkspaceProvider>
          <SidebarProvider>
            <div className="ew-app flex h-screen flex-col">
              <div className="flex flex-1 flex-col overflow-hidden">
                <RouterProvider router={router} />
              </div>
            </div>
          </SidebarProvider>
        </WorkspaceProvider>
      </AppInitializer>
    </UIThemeProvider>
  )
}
