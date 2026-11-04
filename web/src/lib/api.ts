// Types mirror backend/apnigati/api.py (+ grading.py, agents.py, reading.py, worksheets.py).

export type Box = [number, number, number, number]

export interface Status {
  models: Record<string, string>
  graph: { built_by?: string; n_nodes?: number; n_misconceptions?: number; [k: string]: unknown }
}

export interface ClassRow {
  id: string
  school_id: string
  name: string
  grades: unknown
  language: string
  school_name: string
  district: string
  simulated: number
  n_students: number
}

export interface StudentSummary {
  id: string
  class_id: string
  name: string
  grade: number
  language: string
  frontier: string | null
  frontier_id: string | null
  frontier_grade: number | null
  attempts: number
  correct: number
  concepts_mastered: number
  root_cause: string | null
  progress?: SyllabusProgressSummary
  homework?: HomeworkBrief | null
}

// ---------------------------------------------------------------- personalised homework (homework.py)

export type Track = 'placement' | 'challenge' | 'on_track' | 'practice'
export interface SyllabusProgressSummary { total: number; mastered: number; learning: number; percent: number }
export interface SyllabusConceptProgress { id: string; name: string; grade: number; p: number | null; n: number }
export interface SyllabusProgress extends SyllabusProgressSummary { concepts: SyllabusConceptProgress[] }
export interface HomeworkResult { correct: number; attempted: number; total: number }
export type HomeworkStatus = 'assigned' | 'submitted' | 'graded'
export interface HomeworkBrief { id: string; token: string; track: Track; track_label: string; status: HomeworkStatus | string; result: HomeworkResult | null; created: number }
export interface HomeworkItem { n: number; concept_id: string; level: number; question: string; question_en: string; expr: string; answer: string; leak?: boolean }
export interface HomeworkPlan { track: Track; targets: { concept_id: string; level: number; count: number }[]; why: string; recent_accuracy?: number; recent_attempts?: number }
export interface HomeworkRow extends HomeworkBrief { student_id: string; class_id: string; plan: HomeworkPlan; items: HomeworkItem[]; rejected: number; page_id: string | null }
export interface ClassHomeworkRow { student: { id: string; name: string; grade: number; language: string }; progress: SyllabusProgressSummary; homework: HomeworkRow | null }
export type MadeHomework =
  | { id: string; token: string; student: { id: string; name: string }; track: Track; track_label: string; why: string; items: HomeworkItem[]; rejected_by_verifier: number; error?: undefined }
  | { student: { id: string; name: string }; error: string }
export interface SyllabusConcept { id: string; name: string; grade: number; strand: string; ncert_ref: string }
export interface Syllabus { concept_ids: string[]; concepts: SyllabusConcept[]; unmatched?: string[] }
export interface NewStudent { name: string; grade: number; language: string }
export interface Student { id: string; class_id: string; name: string; grade: number; language: string }
export type ChildItemStatus = 'correct' | 'wrong' | 'needs_review' | 'not_attempted'
export interface ChildHomework {
  token: string
  first_name: string
  language: string | null
  track_label: string
  status: 'assigned' | 'submitted' | 'grading' | 'graded' | string
  items: { n: number; question: string; question_en: string }[]
  result: HomeworkResult | null
  page: (Page & { result: (PageResult & { homework?: { id: string; items: { n: number; concept_id: string; status: ChildItemStatus; problem_index?: number }[]; extra_problems: number[] } }) | null }) | null
}

export interface School { id: string; name: string; district: string; block?: string; simulated: number }

export interface ClassDetail {
  id: string
  school_id: string
  name: string
  grades: unknown
  language: string
  school: School | null
  students: StudentSummary[]
}

export interface StepCheck { status: 'true' | 'false' | 'unparseable' | string; claim: string; expected: string | null; detail?: string | null }
export interface Step { text: string; claim: string; box?: Box; box_px: Box; ink_px: Box | null; check: StepCheck }

export interface Diagnosis {
  misconception_id: string
  concept_id: string
  first_error_step: number
  teacher_note: string
  child_hint_en: string
  child_hint_hi: string
  child_hint_ta: string
  pen_note: string
  confidence: number
  agreement?: string
  needs_teacher?: boolean
}

export interface Problem {
  number: string
  problem_text: string
  problem_expr: string
  concept_id: string | null
  answer_text: string
  expected: string | null
  status: 'correct' | 'wrong' | 'needs_review'
  box_px: Box
  answer_px: Box
  answer_ink_px: Box | null
  steps: Step[]
  error_step: number | null
  diagnosis: Diagnosis | null
  trace: string[]
  explanation?: { transcript: string; audio_url: string | null; before: string | null }
  teacher_override?: { from: string; to: string; note: string }
}

export interface GuardrailWarning { type: 'instructions_on_page' | 'no_maths_found' | string; text: string; effect?: string }
export interface HintReview { problem: number; lang: 'en' | 'hi' | 'ta' | string; issues: string[]; action: 'repaired' | 'safe template' | string }
export interface Usage { spent_usd: number; budget_usd: number; breakdown: { model: string; purpose: string; calls: number; cost: number }[] }

export interface PageResult {
  student_name?: string
  size?: [number, number]
  problems?: Problem[]
  score?: { correct: number; total: number }
  ink_segments?: number
  engine?: string
  error?: string
  capture?: { faces_blurred?: number; [k: string]: unknown }
  guardrails?: { warnings?: GuardrailWarning[]; hint_review?: HintReview[] }
}

export interface Page {
  id: string
  class_id: string
  student_id: string | null
  source: string
  image_path: string
  overlay_path: string | null
  status: 'queued' | 'grading' | 'done' | 'error' | string
  result: PageResult | null
  created: number
  image_url: string | null
  overlay_url: string | null
}

export interface Misconception { id: string; name: string; description: string; example_wrong: string; example_right: string; root_concept_id: string }
export interface GraphNode { id: string; name: string; grade: number; strand: string; ncert_ref: string; description: string; prereqs: string[]; misconceptions: Misconception[] }
export interface Graph { nodes: GraphNode[]; meta: Record<string, unknown> }

export interface MasteryRow { concept_id: string; name: string; grade: number; p: number; n: number }
export interface Attempt { id: string; student_id: string; page_id: string | null; concept_id: string; correct: number; misconception_id: string | null; problem: string; source: string; created: number }
export interface TraceItem { tool: string; args?: Record<string, unknown>; result_preview?: string }
export interface ConceptRef { id: string; name: string; grade: number; ncert_ref: string }

export interface DiagnosisResult {
  id?: string
  root_concept_id?: string
  root_concept: ConceptRef | null
  chain?: string[]
  misconception_ids?: string[]
  confidence?: number
  teacher_summary: string
  alternative_hypothesis?: string
  probes?: unknown[]
  trace: TraceItem[]
}
export interface DiagnosisRow { id: string; student_id: string; result: DiagnosisResult; trace: TraceItem[]; created: number }
export interface Probe { id: string; student_id: string; diagnosis_id: string; concept_id: string; question: string; expected: string; answer: string | null; correct: number | null; created: number }

export interface AlignOp { op: 'correct' | 'near' | 'substituted' | 'omitted' | 'inserted'; ref: string | null; said: string | null; similarity?: number }
export interface ReadingResult {
  passage_id: string
  language: string
  passage_level: string
  transcript: string
  alignment: AlignOp[]
  words: number
  correct: number
  errors: number
  accuracy: number
  wcpm: number | null
  seconds: number
  passed: boolean
  level: string
  next_test: string | null
  analysis: { patterns: { pattern: string; examples: string[] }[]; teacher_tip: string; asr_caveat: string }
  error?: string
}
export interface Reading { id: string; student_id: string; passage_id: string; audio_path: string; status: string; result: ReadingResult | null; created: number; audio_url: string | null }

export interface StudentDetail extends Omit<StudentSummary, 'attempts'> {
  attempts: Attempt[]
  mastery: MasteryRow[]
  diagnoses: DiagnosisRow[]
  probes: Probe[]
  readings: Reading[]
  pages: Page[]
  syllabus_progress: SyllabusProgress
  homeworks: HomeworkRow[]
}

export interface PracticeItem { question: string; expr: string; answer: string; verified?: boolean }
export interface PlanGroup {
  key: string
  title: string
  focus_concept_id: string
  focus_concept: ConceptRef | null
  why: string
  activity_minutes: number
  materials: string[]
  steps: string[]
  teacher_script_local: string
  practice: PracticeItem[]
  practice_rejected: number
  exit_check: string
  students: { id: string; name: string; grade: number }[]
}
export interface WorksheetCheck { attempt: number; rendered_questions: number; mismatches: { n: number; expected: string; rendered: string | null }[] }
export interface Worksheet { image_url: string | null; items: PracticeItem[]; verification: WorksheetCheck[]; verified: boolean }
/** Stored worksheet row as returned in plan.worksheets (make_worksheet result nested under `items`). */
interface WorksheetRow { id: string; group_key: string; image_url: string | null; items: { items?: PracticeItem[]; verification?: WorksheetCheck[]; verified?: boolean } | null }
export interface Plan { id: string; created?: number; rotation: string; groups: PlanGroup[]; worksheets?: Record<string, WorksheetRow> }

export interface Passage { id: string; language: string; level: string; text: string }

export interface DistrictSchool extends School { n_students: number; two_plus_grades_behind: number; frontiers: Record<string, number>; misconceptions: Record<string, number> }
export interface District { schools: DistrictSchool[]; top_misconceptions: { id: string; name: string; concept_id: string; total: number }[] }

export function worksheetFromRow(row: WorksheetRow | undefined): Worksheet | null {
  if (!row) return null
  return { image_url: row.image_url, items: row.items?.items ?? [], verification: row.items?.verification ?? [], verified: !!row.items?.verified }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const get = <T>(url: string) => fetch(url).then((r) => handle<T>(r))
export const post = <T>(url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => handle<T>(r))
export const put = <T>(url: string, body: unknown) =>
  fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r))
export const del = <T>(url: string) => fetch(url, { method: 'DELETE' }).then((r) => handle<T>(r))
export const postForm = <T>(url: string, form: FormData) => fetch(url, { method: 'POST', body: form }).then((r) => handle<T>(r))

export const api = {
  status: () => get<Status>('/api/status'),
  graph: () => get<Graph>('/api/graph'),
  classes: () => get<ClassRow[]>('/api/classes'),
  klass: (id: string) => get<ClassDetail>(`/api/classes/${id}`),
  student: (id: string) => get<StudentDetail>(`/api/students/${id}`),
  capture: (classId: string, form: FormData) => postForm<{ batch: string; files: number }>(`/api/classes/${classId}/capture`, form),
  pages: (classId: string) => get<Page[]>(`/api/classes/${classId}/pages`),
  page: (id: string) => get<Page>(`/api/pages/${id}`),
  assign: (pageId: string, student_id: string) => post<Page>(`/api/pages/${pageId}/assign`, { student_id }),
  explain: (pageId: string, index: number, form: FormData) => postForm<Problem>(`/api/pages/${pageId}/problems/${index}/explain`, form),
  override: (pageId: string, index: number, status: 'correct' | 'wrong', note: string) => post<Problem>(`/api/pages/${pageId}/problems/${index}/override`, { status, note }),
  deleteStudent: (id: string) => del<{ deleted: string; files_removed: number }>(`/api/students/${id}`),
  usage: () => get<Usage>('/api/usage'),
  diagnose: (studentId: string) => post<DiagnosisResult>(`/api/students/${studentId}/diagnose`),
  answerProbe: (probeId: string, answer: string) => post<{ correct: boolean; expected: string }>(`/api/probes/${probeId}/answer`, { answer }),
  plan: (classId: string) => get<Plan | null>(`/api/classes/${classId}/plan`),
  makePlan: (classId: string) => post<Plan>(`/api/classes/${classId}/plan`),
  worksheet: (classId: string, group_key: string) => post<Worksheet>(`/api/classes/${classId}/worksheets`, { group_key }),
  passages: () => get<Passage[]>('/api/passages'),
  reading: (studentId: string, form: FormData) => postForm<{ id: string; status: string }>(`/api/students/${studentId}/reading`, form),
  readingResult: (id: string) => get<Reading>(`/api/readings/${id}`),
  district: () => get<District>('/api/district'),
  addStudents: (classId: string, students: NewStudent[]) => post<Student[]>(`/api/classes/${classId}/students/bulk`, { students }),
  syllabus: (classId: string) => get<Syllabus>(`/api/classes/${classId}/syllabus`),
  setSyllabus: (classId: string, body: { concept_ids?: string[]; text?: string }) => put<Syllabus>(`/api/classes/${classId}/syllabus`, body),
  classHomework: (classId: string) => get<ClassHomeworkRow[]>(`/api/classes/${classId}/homework`),
  makeHomework: (classId: string) => post<MadeHomework[]>(`/api/classes/${classId}/homework`),
  childHomework: (token: string) => get<ChildHomework>(`/api/hw/${token}`),
  submitHomework: (token: string, form: FormData) => postForm<{ status: string }>(`/api/hw/${token}/submit`, form),
}

export const homeworkUrl = (token: string) => `${window.location.origin}/hw/${token}`

/** "borrow_without_decrement" -> "Borrow without decrement" */
export function pretty(id: string | null | undefined): string {
  if (!id) return '—'
  const s = id.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}
