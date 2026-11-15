import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function capture(page, name) {
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false)
}

test('signup stays a student until invited; teacher quiz isolation is visible in the UI', async ({
  page,
}) => {
  await page.goto('/signup')
  await capture(page, 'signup')
  await page.getByLabel('Display name').fill('New learner')
  await page.getByLabel('Email', { exact: true }).fill('student@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  await capture(page, 'signup-confirmation')
  await page.goto('/teacher')
  await expect(
    page.getByRole('heading', { name: 'Teacher access required' }),
  ).toBeVisible()
  await capture(page, 'teacher-access-required')
  await page.getByRole('link', { name: 'Enter teacher invitation' }).click()
  await capture(page, 'teacher-enrollment')
  await page.getByLabel('Teacher invitation').fill('wrong-invitation')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not available')
  await page.getByLabel('Teacher invitation').fill('fixture-invitation')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your quizzes' }),
  ).toBeVisible()
  await expect(page.getByText('Your first quiz starts here')).toBeVisible()
  await capture(page, 'teacher-dashboard-empty')
  await page.goto('/teacher/quizzes/30000000-0000-0000-0000-000000000001')
  await expect(page.getByRole('alert')).toContainText(
    'Unable to open this quiz',
  )
})

test('teacher creates a quiz, three independent students play, refresh, and export', async ({
  browser,
  page,
}) => {
  test.setTimeout(120000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [url, name] of [
    ['/login', 'login'],
    ['/login?role=teacher', 'teacher-login'],
    ['/signup?role=teacher', 'teacher-signup'],
    ['/auth/recovery', 'password-recovery'],
    ['/auth/callback', 'auth-callback'],
  ]) {
    await page.goto(url)
    await expect(page.locator('main h1')).toBeVisible()
    await capture(page, name)
  }
  await page.goto('/join')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({
    path: 'test-results/join-updated.png',
    fullPage: true,
  })
  await page.goto('/teacher')
  await expect(page).toHaveURL(/login/)
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your quizzes' }),
  ).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({
    path: 'test-results/teacher-dashboard-updated.png',
    fullPage: true,
  })
  await page.getByRole('link', { name: 'Create quiz +' }).click()
  await page.screenshot({
    path: 'test-results/quiz-builder-updated.png',
    fullPage: true,
  })
  await page.getByLabel('Quiz title', { exact: true }).fill('Browser journey')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.goBack()
  await expect(page.getByLabel('Quiz title', { exact: true })).toHaveValue(
    'Browser journey',
  )
  await expect(page).toHaveURL(/quizzes\/new$/)
  await page
    .getByLabel('Prompt', { exact: true })
    .fill('How many sides does a triangle have?')
  for (let i = 0; i < 4; i++)
    await page
      .getByLabel(`Choice ${i + 1}`, { exact: true })
      .fill(['Three', 'Four', 'Five', 'Six'][i])
  await page
    .getByLabel('Explanation', { exact: true })
    .fill('A triangle has three sides.')
  await page.getByRole('button', { name: 'Save quiz', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to quizzes' }).click()
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Browser journey' }) })
  await card.getByRole('button', { name: 'Host', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Help your students find their spark.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Foxes', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Owls', exact: true }),
  ).toBeVisible()
  const pin = await page.locator('.game-pin').innerText()
  const students = []
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      })
      const student = await context.newPage()
      students.push({ context, page: student })
      student.on('pageerror', (error) => errors.push(error.message))
      await student.goto('/join')
      if (i === 0) await capture(student, 'join-mobile')
      await student.getByLabel('Game PIN').fill(pin)
      await student.getByLabel('Your nickname').fill(`Learner ${i + 1}`)
      await student.getByRole('button', { name: 'Join your team →' }).click()
      await expect(
        student.getByRole('heading', {
          name: 'You’re in. Play for your team.',
        }),
      ).toBeVisible()
    }
    await expect(
      page.getByText('3 connected · 3 joined', { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: 'test-results/host-lobby.png',
      fullPage: true,
    })
    await capture(students[0].page, 'student-lobby')
    await page.getByRole('button', { name: 'Start game', exact: true }).click()
    await capture(page, 'host-question')
    for (const student of students)
      await expect(
        student.page.getByRole('heading', {
          name: 'How many sides does a triangle have?',
        }),
      ).toBeVisible()
    await expect(students[0].page.locator('header')).toHaveCSS(
      'display',
      'flex',
    )
    expect(
      await students[0].page
        .locator('header')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(80)
    await expect(students[0].page.locator('#game-progress')).toHaveCSS(
      'accent-color',
      'rgb(245, 181, 140)',
    )
    await expect(students[1].page.locator('#game-progress')).toHaveCSS(
      'accent-color',
      'rgb(213, 184, 245)',
    )
    await students[0].page.locator('summary').click()
    await expect(
      students[0].page.getByRole('link', { name: 'Study space', exact: true }),
    ).toBeVisible()
    await capture(students[0].page, 'game-menu-mobile')
    await students[0].page.locator('summary').click()
    await students[0].page.screenshot({
      path: 'test-results/student-question-foxes.png',
      fullPage: true,
    })
    await students[1].page.screenshot({
      path: 'test-results/student-question-owls.png',
      fullPage: true,
    })
    await students[0].page.getByRole('button', { name: /A\s*Three/ }).click()
    await expect(students[0].page.getByText(/Answer saved/)).toBeVisible()
    await capture(students[0].page, 'answer-saved')
    await students[0].page.reload()
    await expect(students[0].page.getByText(/Answer saved/)).toBeVisible()
    await expect(
      students[0].page.getByRole('button', { name: /A\s*Three/ }),
    ).toBeDisabled()
    await students[1].page.getByRole('button', { name: /B\s*Four/ }).click()
    await students[2].page.getByRole('button', { name: /A\s*Three/ }).click()
    await expect(
      page.getByText('3 of 3 answered', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Lock answers & reveal' }).click()
    await expect(
      students[0].page.getByRole('heading', {
        name: '✓ Correct! Points for your team.',
      }),
    ).toBeVisible()
    expect(
      (await new AxeBuilder({ page: students[0].page }).analyze()).violations,
    ).toEqual([])
    await expect(
      students[1].page.getByRole('heading', {
        name: '↗ Learn it. Win the next one.',
      }),
    ).toBeVisible()
    await students[0].page.screenshot({
      path: 'test-results/student-feedback-mobile.png',
      fullPage: true,
    })
    await capture(students[1].page, 'student-feedback-incorrect')
    await capture(page, 'host-feedback')
    const overflow = await students[0].page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
    await page.getByRole('button', { name: 'Finish game', exact: true }).click()
    await expect(
      students[0].page.getByRole('heading', {
        name: 'Knowledge played. Points earned.',
      }),
    ).toBeVisible()
    await capture(students[0].page, 'student-results')
    await capture(page, 'host-results')
    const downloading = students[0].page.waitForEvent('download')
    await students[0].page
      .getByRole('button', { name: 'Download my CSV' })
      .click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/grasp-.*\.csv/)
    // The disposable repository does not implement study(); supply screenshot data only.
    // Auth, gameplay, results and session history still use the real local fixture.
    const studyData = {
      theme: 'forest',
      avatar: 'seed',
      streak: 1,
      answered: 1,
      correct: 1,
      inventory: { themes: ['forest'], avatars: ['seed'] },
      mistakes: [],
    }
    for (const target of [page, students[0].page]) {
      await target.route('**/api/study', (route) =>
        route.fulfill({ json: studyData }),
      )
    }
    await students[0].page.goto('/study')
    await expect(
      students[0].page.getByText('1 recent answers · 1 correct'),
    ).toBeVisible()
    await capture(students[0].page, 'student-study')
    await students[0].page.goto('/account/link')
    await expect(
      students[0].page.getByRole('heading', {
        name: 'Keep your study history',
      }),
    ).toBeVisible()
    await capture(students[0].page, 'link-account')
    await students[0].page.goto('/auth/reset')
    await expect(
      students[0].page.getByRole('heading', { name: 'Choose a password' }),
    ).toBeVisible()
    await capture(students[0].page, 'password-reset')
    await page.goto('/teacher/sessions')
    await expect(
      page.getByRole('link', { name: 'Results', exact: true }),
    ).toBeVisible()
    await capture(page, 'teacher-sessions')
    await page.goto('/teacher/quizzes/30000000-0000-0000-0000-000000000001')
    await expect(page.getByLabel('Quiz title', { exact: true })).toHaveValue(
      'Sample arithmetic',
    )
    await capture(page, 'quiz-editor-existing')
    await page.goto('/study')
    await expect(page.getByText('1 recent answers · 1 correct')).toBeVisible()
    await capture(page, 'teacher-study')
    await students[0].page.goto('/teacher')
    await expect(students[0].page).toHaveURL(/login/)
    expect(errors).toEqual([])
  } finally {
    for (const student of students) await student.context.close()
  }
})
