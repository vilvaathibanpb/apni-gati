# Apni Gati: hackathon submission

**Project name:** Apni Gati (अपनी गति, "your own pace")

**Tagline:** Teach once. Every child in the class gets homework that fits their own level, marked in red pen, with progress you can see.

**Track:** Indie Developer · **Problem statement:** Build for Your World

**Links**
- Code (public): https://github.com/vilvaathibanpb/apni-gati
- Demo video (3:00): VIDEO_LINK
- Evaluation results: https://github.com/vilvaathibanpb/apni-gati/blob/main/backend/evals/RESULTS.md

## The problem
- Even in the same class, every child learns at a different pace. A Class 5 room in India holds children still at Class 2 level next to children ready for Class 6 (ASER: about 1 in 2 Class 5 children can't yet read a Class 2 text).
- They all get the same homework: too hard for many, too easy for some, right for only a few.
- A teacher with 40 children can't write, mark and track 40 different sheets every evening, so the slowest fall further behind and the fastest are bored.

## What it does
- **Set up once:** the teacher adds children (name, class, language) and pastes the syllabus in plain words. Muse Wonder maps it onto an NCERT concept graph and lists anything it couldn't match.
- **One tap, every evening:** each child gets a different sheet built from their own knowledge graph.
  - Ready for challenge: fewer, harder, multi-step problems on next topics.
  - On track: class-level practice.
  - Needs practice: the gap underneath, easier questions, more of them, starting with ones they can do.
  - Questions in Tamil, Hindi or English with Indian context; every answer verified with sympy.
- **At home:** the child solves it in the notebook; the family opens the child's own link (no app, no login) and sends a photo.
- **Red-pen marking against the answer key:** ticks, crosses and circles drawn on the photo; each mistake gets the misconception behind it and a hint in the child's language that never gives the answer.
- **Progress:** the child's knowledge graph updates, the syllabus progress bar moves (easy questions count as weaker evidence), and a Muse Wonder agent traces mistakes to the root prerequisite gap and writes probe questions. The next sheet adapts.
- **For the teacher:** mark a whole stack of notebooks (photos or a flip-through video), oral reading tests in Tamil, Hindi and English, group lesson plans with verified printable worksheets, a district view of common misconceptions.

## How we use Meta's models (all through the Meta Model API)
- **Muse Spark 1.3:** reads children's handwriting with grounded boxes; zoomed re-reads before anything is marked wrong; writes each child's homework in their language; two independent misconception diagnoses; hint safety review; worksheet read-back check.
- **Muse Wonder 1.0:** built the NCERT concept graph (36 concepts, 73 misconceptions) using web search; maps the teacher's syllabus; root-cause agent with tools over the child's evidence; breaks ties between diagnoses; plans group lessons.
- **SAM 3.1:** finds and straightens the notebook page; tracks pages through a flip-through video; pixel masks of handwritten digits so red marks sit on the ink; blurs faces before storage.
- **Muse Voice Transcribe:** oral reading assessment and children's spoken explanations (deliberately without keyword biasing, so real misreadings aren't hidden).
- **Muse Image 1.0:** illustrated, printable worksheets, each read back and checked before printing.

## Engineering highlights
- **The model reads; maths decides.** Correctness comes only from sympy, never from a model's opinion, so text written on a page can't change a grade.
- **Never guess:** illegible answers, incomplete questions and disagreeing readings go to the teacher; the teacher can override any mark.
- **Per-child knowledge tracing** (Bayesian) over a prerequisite graph, rebuilt from full history so re-grading never double-counts.
- **Guardrails:** faces blurred, raw uploads deleted, children's data only sent in Standard mode (not used for training), hints checked for answer leaks, tone and script, agent outputs clamped to the graph, upload limits, API cost ledger with a hard budget cap.

## Results (full details in RESULTS.md)
- **Notebook grading** (12 pages, 40 problems, 16 planted mistakes): 40/40 right/wrong; 0 correct answers marked wrong; 0 mistakes missed; ambiguous problems go to the teacher; misconception diagnosed exactly 13/16.
- **Personalised homework** (one Class 5, 12 children): 82/82 answers verified; 0 identical sheets; difficulty and length follow each child's track; end-to-end photo → red pen → progress verified.
- **Reading aloud** (Tamil, Hindi, English): 9/9 planted misreadings caught, 0 false alarms.
- **Safety:** prompt injection on a page ignored; faces blurred; 6/6 unsafe hints repaired; budget cap and upload limits hold.
- **Honest limits:** a plain one-call model also judges right/wrong well (we add proof, the failing step, the reason and safe failure); root-causing from sparse homework is uncertain (agent 2/10 exact vs baseline 0/10), so the agent writes probe questions to check with the child; test pages are AI-generated.

## Built during the hackathon (Oct 27 – Nov 4, 2026)
- Everything in the repository: backend, web app, concept graph, homework engine, agents, guardrails, evals and the demo-video tooling. No prior code.

## Stack
- Python, FastAPI, SQLite, sympy, OpenCV · React, Vite, Tailwind (mobile-first web app) · Meta Model API for all AI.
