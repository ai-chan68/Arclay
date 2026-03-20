import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AppInitializer } from '../components/layout'
import { UIThemeProvider } from '@/shared/theme/ui-theme'
import { SidebarProvider } from '@/components/task-detail/SidebarContext'

export function App() {
  return (
    <UIThemeProvider>
      <AppInitializer>
        <SidebarProvider>
          <div className="ew-app flex h-screen flex-col">
            <div className="flex flex-1 flex-col overflow-hidden">
              <RouterProvider router={router} />
            </div>
          </div>
        </SidebarProvider>
      </AppInitializer>
    </UIThemeProvider>
  )
}
