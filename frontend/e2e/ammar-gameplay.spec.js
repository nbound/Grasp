import { test, expect } from '@playwright/test'

// Gameplay journeys for GR-07, GR-22, GR-23, GR-34 and GR-38, driven through the
// real UI against the disposable fixture started by playwright.config.js.
//
// The whole Playwright run shares one database. game.spec.js owns
// teacher@example.test (teacher A) and asserts on that teacher's sessions, so
// nothing here signs in as teacher A or signs up student@example.test.
//
// The game server allows each verified identity 30 socket/HTTP operations per
// minute (server/src/app.js:36-47); a host spends about two per click (command
// plus sync) and one per 15 s resync. Teacher B (other@example.test) hosts the
// lobby checks and the timed run. The untimed run and the reconnect game are
// hosted by teachers enrolled in the test (unique emails, fixture invitation),
// so no identity can run out of budget however the tests line up in time.
const TEACHER_B = 'other@example.test'
const PASSWORD = 'fixture-password'
const INVITATION = 'fixture-invitation'
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
}
const DEFAULT_POINTS = 1000 // QuizEditor default for a new question
const TEAMS = ['Foxes', 'Owls'] // teamIdentity: team 1 = Foxes, team 2 = Owls
const OUTCOME_HEADINGS = {
  correct: '✓ Correct! Points for Your Team.',
  wrong: '↗ Learn It. Win the Next One.',
  none: '— No Answer Submitted.',
}
const QUESTIONS = [
  {
    prompt: 'Which planet is closest to the Sun?',
    choices: ['Venus', 'Mercury', 'Earth', 'Mars'],
    correct: 1,
    explanation: 'Mercury orbits closest to the Sun.',
  },
  {
    prompt: 'What is the chemical symbol for gold?',
    choices: ['Ag', 'Gd', 'Au', 'Go'],
    correct: 2,
    explanation: 'Au comes from the Latin aurum.',
  },
  {
    prompt: 'How many sides does a hexagon have?',
    choices: ['Six', 'Five', 'Seven', 'Eight'],
    correct: 0,
    explanation: 'Hex means six.',
  },
]
const NICKNAMES = ['Ada', 'Ben', 'Cy']
// Choice index per nickname for each question; a missing nickname never answers.
// Ada: correct, correct, wrong (streak 1, 2, 0). Cy misses question 1.
const PLAN = [
  { Ada: 1, Ben: 0 },
  { Ada: 2, Ben: 2, Cy: 0 },
  { Ada: 3, Ben: 0, Cy: 0 },
]

const tag = () => Math.random().toString(36).slice(2, 8)

// Teams are balanced on join (fewest players, then lowest team number:
// supabase/migrations/20261029000000_initial_schema.sql:341-344), so sequential
// joins alternate Foxes, Owls, Foxes.
const teamOf = (index) => TEAMS[index % TEAMS.length]

// Fixed points for a correct answer, zero otherwise; the streak only counts.
function expectedGame(nicknames, plan, questions = QUESTIONS) {
  const streak = Object.fromEntries(nicknames.map((n) => [n, 0]))
  const totals = Object.fromEntries(nicknames.map((n) => [n, 0]))
  return questions.map((question, q) => {
    const players = {}
    for (const nickname of nicknames) {
      const choice = plan[q][nickname]
      const outcome =
        choice === undefined
          ? 'none'
          : choice === question.correct
            ? 'correct'
            : 'wrong'
      const points = outcome === 'correct' ? DEFAULT_POINTS : 0
      streak[nickname] = outcome === 'correct' ? streak[nickname] + 1 : 0
      totals[nickname] += points
      players[nickname] = { outcome, points, streak: streak[nickname] }
    }
    const teamTotals = Object.fromEntries(
      TEAMS.map((team) => [
        team,
        nicknames
          .filter((_, i) => teamOf(i) === team)
          .reduce((sum, n) => sum + totals[n], 0),
      ]),
    )
    const board = Object.fromEntries(
      TEAMS.map((team) => [
        team,
        {
          rank:
            1 + TEAMS.filter((t) => teamTotals[t] > teamTotals[team]).length,
          score: teamTotals[team],
        },
      ]),
    )
    return { players, board }
  })
}

function trackErrors(page, label, errors) {
  page.on('pageerror', (error) =>
    errors.push(`${label} pageerror: ${error.message}`),
  )
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(`${label} console: ${message.text()}`)
  })
}

// Close every context even when one close fails, so no browser is left behind.
async function closeAll(contexts) {
  await Promise.allSettled(contexts.map((context) => context.close()))
}

async function signInTeacherB(page) {
  await page.goto('/login?role=teacher')
  await page.getByLabel('Email', { exact: true }).fill(TEACHER_B)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your Quizzes' }),
  ).toBeVisible()
}

async function enrollNewTeacher(page, label) {
  await page.goto('/signup?role=teacher')
  await page.getByLabel('Display Name').fill(`Gameplay ${label}`)
  await page
    .getByLabel('Email', { exact: true })
    .fill(`gameplay-${label}-${tag()}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  await page.goto('/teacher-enrollment')
  await page.getByLabel('Teacher Invitation').fill(INVITATION)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your Quizzes' }),
  ).toBeVisible()
}

// Builds a quiz in the editor and leaves the page on the saved quiz.
async function createQuiz(page, { title, timer, questions = QUESTIONS }) {
  await page.getByRole('link', { name: 'Create Quiz +' }).click()
  await page.getByLabel('Quiz Title', { exact: true }).fill(title)
  await expect(page.getByLabel('Feedback Timing')).toHaveValue('after_question')
  const timerToggle = page.getByRole('checkbox', {
    name: 'Enable Question Timers (never changes points)',
  })
  await expect(timerToggle).not.toBeChecked()
  if (timer) await timerToggle.check()
  for (const [i, question] of questions.entries()) {
    if (i > 0)
      await page.getByRole('button', { name: 'Add Question +' }).click()
    const card = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: `Question ${i + 1}`,
        exact: true,
      }),
    })
    await card.getByLabel('Prompt', { exact: true }).fill(question.prompt)
    for (const [c, choice] of question.choices.entries())
      await card.getByLabel(`Choice ${c + 1}`, { exact: true }).fill(choice)
    await card
      .getByRole('radio', {
        name: `Choice ${question.correct + 1} is correct for question ${i + 1}`,
      })
      .check()
    await card
      .getByLabel('Explanation', { exact: true })
      .fill(question.explanation)
    await expect(card.getByLabel('Points for a Correct Answer')).toHaveValue(
      String(DEFAULT_POINTS),
    )
    const limit = card.getByLabel('Time Limit (Seconds)')
    if (timer) {
      await expect(limit).toHaveAttribute('min', '5')
      await limit.fill('5')
    } else await expect(limit).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Save Quiz', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible()
}

async function hostQuiz(page, title) {
  await page.getByRole('link', { name: 'Back to Quizzes' }).click()
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: 'Host', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Help Your Students Find Their Spark.' }),
  ).toBeVisible()
  return (await page.locator('.game-pin').innerText()).trim()
}

async function newStudentPage(browser, contexts, errors, label) {
  const context = await browser.newContext(PHONE)
  contexts.push(context)
  const page = await context.newPage()
  trackErrors(page, label, errors)
  await page.goto('/join')
  return page
}

async function submitJoin(page, pin, nickname) {
  await page.getByLabel('Game PIN').fill(pin)
  await page.getByLabel('Your Nickname').fill(nickname)
  await page.getByRole('button', { name: 'Join Your Team →' }).click()
}

async function joinStudents(browser, contexts, errors, pin, nicknames) {
  const students = []
  for (const [i, nickname] of nicknames.entries()) {
    const page = await newStudentPage(browser, contexts, errors, nickname)
    await submitJoin(page, pin, nickname)
    await expect(
      page.getByRole('heading', { name: 'You’re In. Play for Your Team.' }),
    ).toBeVisible()
    await expect(
      page.getByText(`You are ${nickname}, on ${teamOf(i)}.`, { exact: true }),
    ).toBeVisible()
    students.push({ nickname, team: teamOf(i), color: i % TEAMS.length, page })
  }
  return students
}

async function startGame(host, count) {
  await expect(
    host.getByText(`${count} connected · ${count} joined`, { exact: true }),
  ).toBeVisible()
  await host.getByRole('button', { name: 'Start Game', exact: true }).click()
}

function choiceButton(page, question, choice) {
  const letter = String.fromCharCode(65 + choice)
  return page.getByRole('button', {
    name: new RegExp(`^${letter}\\s*${question.choices[choice]}`),
  })
}

async function answer(student, question, choice) {
  await choiceButton(student.page, question, choice).click()
  await expect(student.page.getByText(/^Answer saved\./)).toBeVisible()
}

async function expectFeedback(page, expected, options) {
  await expect(
    page.getByRole('heading', {
      name: OUTCOME_HEADINGS[expected.outcome],
      exact: true,
    }),
  ).toBeVisible(options)
  await expect(
    page.getByText(`+${expected.points} points`, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(`✦ ${expected.streak} answer streak`, { exact: true }),
  ).toBeVisible()
}

// { Foxes: { rank, score }, Owls: { rank, score } } from the visible scoreboard.
async function readScoreboard(page) {
  const rows = await page
    .locator('section')
    .filter({
      has: page.getByRole('heading', { name: 'Team Scoreboard', exact: true }),
    })
    .getByRole('listitem')
    .evaluateAll((items) =>
      items.map((li) => [
        li.querySelector('span').textContent,
        li.querySelector('strong').textContent,
      ]),
    )
  return Object.fromEntries(
    rows.map(([label, score]) => {
      const [, rank, name] = label.match(/^#(\d+)\s+\S+\s+(.+)$/u)
      return [
        name,
        { rank: Number(rank), score: Number(score.replace(/\D/g, '')) },
      ]
    }),
  )
}

async function readResults(page) {
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  return table.locator('tbody tr').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.cells[0].textContent,
      question: row.cells[1].firstChild.textContent,
      answer: row.cells[2].textContent,
      points: Number(row.cells[4].textContent),
    })),
  )
}

function expectedResults(nicknames, plan, questions = QUESTIONS) {
  const game = expectedGame(nicknames, plan, questions)
  return nicknames.flatMap((name) =>
    questions.map((question, q) => ({
      name,
      question: question.prompt,
      answer:
        plan[q][name] === undefined
          ? 'Not answered'
          : question.choices[plan[q][name]],
      points: game[q].players[name].points,
    })),
  )
}

// Plays every question with PLAN and returns what the UI showed: the host's
// Team Scoreboard after each question and each student's awarded points.
async function playGame({ host, students, timed }) {
  const nicknames = students.map((s) => s.nickname)
  const expected = expectedGame(nicknames, PLAN)
  const observed = []
  for (const [q, question] of QUESTIONS.entries()) {
    for (const student of students) {
      await expect(
        student.page.getByRole('heading', { name: question.prompt }),
      ).toBeVisible()
      // GR-22: no scoreboard while the question is open.
      await expect(
        student.page.getByRole('heading', { name: 'Team Scoreboard' }),
      ).toHaveCount(0)
    }
    const shownAt = Date.now()
    for (const page of [host, ...students.map((s) => s.page)]) {
      if (timed)
        await expect(
          page.getByRole('timer', { name: 'Seconds remaining' }),
        ).toHaveText(/^[1-5] seconds remaining$/)
      else await expect(page.getByRole('timer')).toHaveCount(0)
    }
    const answering = students.filter((s) => PLAN[q][s.nickname] !== undefined)
    for (const student of answering)
      await answer(student, question, PLAN[q][student.nickname])
    await expect(
      host.getByText(`${answering.length} of ${students.length} answered`, {
        exact: true,
      }),
    ).toBeVisible()
    const reveal = host.getByRole('button', { name: 'Lock Answers & Reveal' })
    if (timed) {
      // GR-38: nobody clicks; the server's 1 s expiry interval closes it.
      await expect(
        host.getByRole('heading', { name: 'Answer Revealed' }),
      ).toBeVisible({ timeout: 15000 })
      expect(Date.now() - shownAt).toBeGreaterThanOrEqual(3000)
      await expect(reveal).toHaveCount(0)
    } else {
      if (q === 0) {
        // Bounded wait on purpose: proves nothing closes an untimed question
        // after the 5 s the timed run used, while Cy still has not answered.
        await host.waitForTimeout(Math.max(0, 7000 - (Date.now() - shownAt)))
        await expect(reveal).toBeEnabled()
        for (const student of students)
          await expect(student.page.locator('.feedback')).toHaveCount(0)
        const missing = students.find((s) => PLAN[q][s.nickname] === undefined)
        await expect(choiceButton(missing.page, question, 0)).toBeEnabled()
      }
      await reveal.click()
      await expect(
        host.getByRole('heading', { name: 'Answer Revealed' }),
      ).toBeVisible()
    }
    const points = {}
    for (const student of students) {
      await expectFeedback(student.page, expected[q].players[student.nickname])
      const awarded = await student.page.getByText(/^\+\d+ points$/).innerText()
      points[student.nickname] = Number(awarded.match(/\d+/)[0])
      await expect(student.page.getByRole('timer')).toHaveCount(0)
      await expect
        .poll(() => readScoreboard(student.page))
        .toEqual(expected[q].board)
    }
    await expect.poll(() => readScoreboard(host)).toEqual(expected[q].board)
    observed.push({ board: await readScoreboard(host), points })
    await host
      .getByRole('button', {
        name: q + 1 === QUESTIONS.length ? 'Finish Game' : 'Next Question',
        exact: true,
      })
      .click()
  }
  await expect(
    host.getByRole('heading', { name: 'Look What Your Students Figured Out.' }),
  ).toBeVisible()
  const results = await readResults(host)
  expect(results).toEqual(expectedResults(nicknames, PLAN))
  return { observed, results }
}

test('GR-07: a wrong PIN shows "No game found with that PIN."', async ({
  browser,
}) => {
  // Known fixture gap, not a production bug: fixtureRepository.join
  // (server/tests/fixtureRepository.mjs:92-111) calls join_game without looking
  // the PIN up first, so the unknown PIN surfaces as join_game's P0001, which
  // joinError (server/src/errors.js:12) maps to SESSION_CLOSED: "This game has
  // expired." The production repository looks the PIN up and returns BAD_PIN
  // (server/src/repository.js:107-115). Remove test.fail() once they match.
  test.fail()
  const errors = [],
    contexts = []
  try {
    const page = await newStudentPage(browser, contexts, errors, 'student')
    await submitJoin(page, '000000', 'Wanderer')
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(page).toHaveURL(/\/join$/)
    expect(errors).toEqual([])
    expect(await alert.innerText()).toBe('No game found with that PIN.')
  } finally {
    await closeAll(contexts)
  }
})

test('GR-07 and GR-34 in the lobby: bad PINs and taken nicknames are refused; a reload keeps nickname and team', async ({
  browser,
  page,
}) => {
  const errors = [],
    contexts = []
  trackErrors(page, 'host', errors)
  try {
    await signInTeacherB(page)
    const title = `Lobby checks ${tag()}`
    await createQuiz(page, { title, questions: QUESTIONS.slice(0, 1) })
    const pin = await hostQuiz(page, title)
    const [ada] = await joinStudents(browser, contexts, errors, pin, ['Ada'])

    const second = await newStudentPage(browser, contexts, errors, 'second')
    const wrongPin = String((Number(pin) + 1) % 1000000).padStart(6, '0')
    await submitJoin(second, wrongPin, 'Bea')
    await expect(second.getByRole('alert')).toBeVisible()
    await expect(second).toHaveURL(/\/join$/)
    // Nicknames are unique per game regardless of case or surrounding spaces.
    for (const taken of ['Ada', 'ada', 'ADA', '  aDa  ']) {
      await second.goto('/join')
      await submitJoin(second, pin, taken)
      await expect(second.getByRole('alert')).toHaveText(
        'That nickname is taken.',
      )
      await expect(second).toHaveURL(/\/join$/)
    }
    await expect(
      page.getByText('1 connected · 1 joined', { exact: true }),
    ).toBeVisible()
    await second.goto('/join')
    await submitJoin(second, pin, 'Bea')
    await expect(
      second.getByText('You are Bea, on Owls.', { exact: true }),
    ).toBeVisible()

    // GR-34: reloading in the lobby restores the same player and team.
    const lobbyUrl = ada.page.url()
    expect(lobbyUrl).toMatch(/\/play\/[0-9a-f-]{36}$/)
    await ada.page.reload()
    await expect(ada.page).toHaveURL(lobbyUrl)
    await expect(
      ada.page.getByText('You are Ada, on Foxes.', { exact: true }),
    ).toBeVisible()
    await expect(ada.page.locator('main')).toHaveClass(/\bteam-color-0\b/)
    await expect(second.locator('main')).toHaveClass(/\bteam-color-1\b/)
    await expect(
      page.getByText('2 connected · 2 joined', { exact: true }),
    ).toBeVisible()
    for (const [team, nickname] of [
      ['Foxes', 'Ada'],
      ['Owls', 'Bea'],
    ])
      await expect(
        page
          .locator('section')
          .filter({
            has: page.getByRole('heading', { name: team, exact: true }),
          })
          .getByRole('listitem'),
      ).toHaveText([`${nickname} · ready`])
    expect(errors).toEqual([])
  } finally {
    await closeAll(contexts)
  }
})

test('GR-38, GR-22, GR-23: a 5 s timed quiz closes itself and scores exactly like the untimed run', async ({
  browser,
  page,
}) => {
  test.setTimeout(180000)
  const errors = [],
    contexts = []
  trackErrors(page, 'timed host', errors)
  const nicknames = NICKNAMES
  const expected = expectedGame(nicknames, PLAN)
  try {
    // Timed run, hosted by teacher B.
    await signInTeacherB(page)
    const timedTitle = `Timed planets ${tag()}`
    await createQuiz(page, { title: timedTitle, timer: true })
    const timedPin = await hostQuiz(page, timedTitle)
    const timedStudents = await joinStudents(
      browser,
      contexts,
      errors,
      timedPin,
      nicknames,
    )
    await startGame(page, nicknames.length)
    const timed = await playGame({
      host: page,
      students: timedStudents,
      timed: true,
    })

    // Untimed run of the same questions and answers, from a brand-new quiz
    // whose timer checkbox is left at its default (createQuiz asserts it is
    // unchecked and that no Time Limit field is shown).
    const untimedContext = await browser.newContext()
    contexts.push(untimedContext)
    const host = await untimedContext.newPage()
    trackErrors(host, 'untimed host', errors)
    await enrollNewTeacher(host, 'untimed')
    const untimedTitle = `Untimed planets ${tag()}`
    await createQuiz(host, { title: untimedTitle, timer: false })
    const untimedPin = await hostQuiz(host, untimedTitle)
    const untimedStudents = await joinStudents(
      browser,
      contexts,
      errors,
      untimedPin,
      nicknames,
    )
    await startGame(host, nicknames.length)
    const untimed = await playGame({ host, students: untimedStudents })

    // Same scoreboards after every question and the same points per student.
    expect(untimed.observed).toEqual(timed.observed)
    expect(untimed.results).toEqual(timed.results)
    expect(timed.observed).toEqual(
      expected.map(({ players, board }) => ({
        board,
        points: Object.fromEntries(
          nicknames.map((n) => [n, players[n].points]),
        ),
      })),
    )

    // GR-23: each student's total is fixed points per correct answer; the
    // streak never adds anything.
    for (const student of [...timedStudents, ...untimedStudents]) {
      await expect(
        student.page.getByRole('heading', {
          name: 'Knowledge Played. Points Earned.',
        }),
      ).toBeVisible()
      const own = await readResults(student.page)
      expect(own.map((row) => row.name)).toEqual(
        QUESTIONS.map(() => student.nickname),
      )
      const correct = PLAN.filter(
        (answers, q) => answers[student.nickname] === QUESTIONS[q].correct,
      ).length
      expect(own.reduce((sum, row) => sum + row.points, 0)).toBe(
        DEFAULT_POINTS * correct,
      )
    }
    expect(errors).toEqual([])
  } finally {
    await closeAll(contexts)
  }
})

test('GR-34: students who reload mid-question and mid-feedback keep their nickname, team and answer', async ({
  browser,
  page,
}) => {
  test.setTimeout(120000)
  const errors = [],
    contexts = []
  trackErrors(page, 'host', errors)
  const questions = QUESTIONS.slice(0, 1)
  const nicknames = ['Ada', 'Ben']
  const plan = [{ Ada: 1, Ben: 3 }]
  const expected = expectedGame(nicknames, plan, questions)
  try {
    await enrollNewTeacher(page, 'reconnect')
    const title = `Reconnect planets ${tag()}`
    await createQuiz(page, { title, questions })
    const pin = await hostQuiz(page, title)
    const [ada, ben] = await joinStudents(
      browser,
      contexts,
      errors,
      pin,
      nicknames,
    )
    await startGame(page, nicknames.length)
    const [question] = questions
    for (const student of [ada, ben])
      await expect(
        student.page.getByRole('heading', { name: question.prompt }),
      ).toBeVisible()
    const gameUrl = ada.page.url()
    expect(gameUrl).toMatch(/\/play\/[0-9a-f-]{36}$/)

    // Mid-question, after answering: the saved answer comes back locked.
    await answer(ada, question, plan[0].Ada)
    await ada.page.reload()
    await expect(ada.page).toHaveURL(gameUrl)
    await expect(ada.page.getByText(/^Answer saved\./)).toBeVisible()
    await expect(choiceButton(ada.page, question, plan[0].Ada)).toHaveText(
      /✓ Selected$/,
    )
    for (const choice of question.choices.keys())
      await expect(choiceButton(ada.page, question, choice)).toBeDisabled()

    // Mid-question, before answering: the question is still answerable.
    await ben.page.reload()
    await expect(ben.page).toHaveURL(gameUrl)
    await expect(
      ben.page.getByRole('heading', { name: question.prompt }),
    ).toBeVisible()
    await answer(ben, question, plan[0].Ben)
    await expect(
      page.getByText('2 of 2 answered', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Lock Answers & Reveal' }).click()

    // Mid-feedback: the same outcome, points and team after a reload.
    for (const student of [ada, ben]) {
      await expectFeedback(student.page, expected[0].players[student.nickname])
      await student.page.reload()
      await expect(student.page).toHaveURL(gameUrl)
      await expectFeedback(student.page, expected[0].players[student.nickname])
      await expect(student.page.locator('main')).toHaveClass(
        new RegExp(`\\bteam-color-${student.color}\\b`),
      )
      await expect
        .poll(() => readScoreboard(student.page))
        .toEqual(expected[0].board)
    }

    // The results rows still carry each original nickname.
    await page.getByRole('button', { name: 'Finish Game', exact: true }).click()
    expect(await readResults(page)).toEqual(
      expectedResults(nicknames, plan, questions),
    )
    for (const student of [ada, ben]) {
      await expect(
        student.page.getByRole('heading', {
          name: 'Knowledge Played. Points Earned.',
        }),
      ).toBeVisible()
      expect(await readResults(student.page)).toEqual(
        expectedResults([student.nickname], plan, questions),
      )
    }
    expect(errors).toEqual([])
  } finally {
    await closeAll(contexts)
  }
})
