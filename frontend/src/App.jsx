import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { StudentApp } from './features/student/StudentApp.jsx'
import { createStudentClient } from './features/student/services/createStudentClient.js'

const client = createStudentClient(import.meta.env)
const StarterPage = lazy(() => import('./features/starter/StarterPage.jsx'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p role="status">Loading page…</p>}>
        <Routes>
          <Route path="/dev/starter" element={<StarterPage />} />
          <Route path="*" element={<StudentApp client={client} />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
