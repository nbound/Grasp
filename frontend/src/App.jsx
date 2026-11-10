import {
  BrowserRouter,
  Navigate,
  Route,
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
} from 'react-router'
import { lazy } from 'react'
import { StudentApp } from './features/student/StudentApp.jsx'
import { createStudentClient } from './features/student/services/createStudentClient.js'
import { AuthProvider } from './app/AuthProvider.jsx'
import { Shell, ProtectedRoute } from './app/Shell.jsx'
import { AuthPage } from './features/auth/AuthPage.jsx'
import { AuthCallback } from './features/auth/AuthCallback.jsx'
import { JoinGame } from './features/join/JoinGame.jsx'
import { History } from './features/results/History.jsx'
import './app/app.css'

const Dashboard = lazy(() =>
  import('./features/quizzes/Dashboard.jsx').then((module) => ({
    default: module.Dashboard,
  })),
)
const QuizEditor = lazy(() =>
  import('./features/quizzes/QuizEditor.jsx').then((module) => ({
    default: module.QuizEditor,
  })),
)
const GamePage = lazy(() =>
  import('./features/game/GamePage.jsx').then((module) => ({
    default: module.GamePage,
  })),
)
const StudyPage = lazy(() =>
  import('./features/study/StudyPage.jsx').then((module) => ({
    default: module.StudyPage,
  })),
)

const demo = import.meta.env.DEV && import.meta.env.VITE_STUDENT_DEMO === 'true'
const demoClient = demo ? createStudentClient(import.meta.env) : null

const router = demo
  ? null
  : createBrowserRouter(
      createRoutesFromElements(
        <Route
          element={
            <AuthProvider>
              <Shell />
            </AuthProvider>
          }
        >
          <Route path="/join" element={<JoinGame />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/auth/recovery" element={<AuthPage mode="recovery" />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/auth/reset" element={<AuthPage mode="reset" />} />
            <Route path="/account/link" element={<AuthPage mode="link" />} />
            <Route
              path="/teacher-enrollment"
              element={<AuthPage mode="enroll" />}
            />
            <Route path="/play/:sessionId/*" element={<GamePage />} />
            <Route path="/study" element={<StudyPage />} />
          </Route>
          <Route element={<ProtectedRoute teacher />}>
            <Route path="/teacher" element={<Dashboard />} />
            <Route path="/teacher/quizzes/:id" element={<QuizEditor />} />
            <Route path="/teacher/host/:sessionId" element={<GamePage />} />
            <Route
              path="/teacher/sessions"
              element={
                <main className="wide">
                  <h1>Your sessions</h1>
                  <History teacher />
                </main>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/join" replace />} />
        </Route>,
      ),
    )

export default function App() {
  return demo ? (
    <BrowserRouter>
      <StudentApp client={demoClient} />
    </BrowserRouter>
  ) : (
    <RouterProvider router={router} />
  )
}
