import { BrowserRouter } from 'react-router'
import { StudentApp } from './features/student/StudentApp.jsx'
import { createStudentClient } from './features/student/services/createStudentClient.js'

const client = createStudentClient(import.meta.env)

export default function App() {
  return (
    <BrowserRouter>
      <StudentApp client={client} />
    </BrowserRouter>
  )
}
