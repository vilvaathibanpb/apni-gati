import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { StatusProvider } from './lib/status'
import { Empty, Shell } from './ui'
import ClassList from './pages/ClassList'
import ClassHome from './pages/ClassHome'
import Capture from './pages/Capture'
import PageReview from './pages/PageReview'
import StudentProfile from './pages/StudentProfile'
import PlanPage from './pages/Plan'
import ReadingTest from './pages/Reading'
import DistrictPage from './pages/District'
import About from './pages/About'
import ClassSetup from './pages/ClassSetup'
import HomeworkPage from './pages/Homework'
import HomeworkPrint from './pages/HomeworkPrint'
import ChildHomeworkPage from './pages/ChildHomework'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  return (
    <StatusProvider>
      <BrowserRouter>
        <ScrollTop />
        <Routes>
          {/* The child's own page: no teacher chrome. */}
          <Route path="/hw/:token" element={<ChildHomeworkPage />} />
          <Route path="*" element={<TeacherApp />} />
        </Routes>
      </BrowserRouter>
    </StatusProvider>
  )
}

function TeacherApp() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<ClassList />} />
        <Route path="/class/:id" element={<ClassHome />} />
        <Route path="/class/:id/setup" element={<ClassSetup />} />
        <Route path="/class/:id/homework" element={<HomeworkPage />} />
        <Route path="/class/:id/homework/print" element={<HomeworkPrint />} />
        <Route path="/class/:id/capture" element={<Capture />} />
        <Route path="/class/:id/plan" element={<PlanPage />} />
        <Route path="/class/:id/reading" element={<ReadingTest />} />
        <Route path="/page/:id" element={<PageReview />} />
        <Route path="/student/:id" element={<StudentProfile />} />
        <Route path="/district" element={<DistrictPage />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Empty title="Page not found">That link doesn’t lead anywhere.</Empty>} />
      </Routes>
    </Shell>
  )
}
