import { createBrowserRouter } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { TaskDetailPage } from './pages/TaskDetail'
import { LibraryPage } from './pages/Library'
import { ScheduledTasksPage } from './pages/ScheduledTasks'
import { WelcomePage } from './pages/Welcome'
import { SetupGuard } from '@/components/setup-guard'

export const router = createBrowserRouter([
  {
    path: '/welcome',
    element: <WelcomePage />
  },
  {
    path: '/',
    element: (
      <SetupGuard>
        <HomePage />
      </SetupGuard>
    )
  },
  {
    path: '/chat',
    element: (
      <SetupGuard>
        <HomePage />
      </SetupGuard>
    )
  },
  {
    path: '/task/:taskId',
    element: (
      <SetupGuard>
        <TaskDetailPage />
      </SetupGuard>
    )
  },
  {
    path: '/library',
    element: (
      <SetupGuard>
        <LibraryPage />
      </SetupGuard>
    )
  },
  {
    path: '/scheduled-tasks',
    element: (
      <SetupGuard>
        <ScheduledTasksPage />
      </SetupGuard>
    )
  }
])
