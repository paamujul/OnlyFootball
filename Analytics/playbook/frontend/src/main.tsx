import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import { SeasonProvider } from './state'
import TeamPage from './pages/TeamPage'
import PlayerPage from './pages/PlayerPage'
import ComparePage from './pages/ComparePage'
import DefenseLabPage from './pages/DefenseLabPage'
import CoachPage from './pages/CoachPage'
import CoachIndexPage from './pages/CoachIndexPage'
import HeatmapPage from './pages/HeatmapPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/coach" replace /> },
      { path: 'team/:abbr', element: <TeamPage /> },
      { path: 'player/:id', element: <PlayerPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'defense', element: <DefenseLabPage /> },
      { path: 'coach', element: <CoachIndexPage /> },
      { path: 'coach/:abbr', element: <CoachPage /> },
      { path: 'heatmap', element: <HeatmapPage /> },
      { path: 'red-zone', element: <Navigate to="/heatmap" replace /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SeasonProvider>
      <RouterProvider router={router} />
    </SeasonProvider>
  </StrictMode>,
)
