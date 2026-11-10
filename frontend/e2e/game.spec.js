import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('signup stays a student until invited; teacher quiz isolation is visible in the UI', async ({
  page,
}) => {
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('New learner')
  await page.getByLabel('Email', { exact: true }).fill('student@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  await page.goto('/teacher')
  await expect(
    page.getByRole('heading', { name: 'Teacher access required' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Enter teacher invitation' }).click()
  await page.getByLabel('Teacher invitation').fill('wrong-invitation')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not available')
  await page.getByLabel('Teacher invitation').fill('fixture-invitation')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your quizzes' }),
  ).toBeVisible()
  await expect(page.getByText('Your first quiz starts here')).toBeVisible()
  await page.goto('/teacher/quizzes/30000000-0000-0000-0000-000000000001')
  await expect(page.getByRole('alert')).toContainText(
    'Unable to open this quiz',
  )
})

test('teacher creates a quiz, three independent students play, refresh, and export', async ({
  browser,
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/teacher')
  await expect(page).toHaveURL(/login/)
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your quizzes' }),
  ).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('link', { name: 'Create quiz +' }).click()
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
    page.getByRole('heading', { name: 'Bring everyone together.' }),
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
      await student.getByLabel('Game PIN').fill(pin)
      await student.getByLabel('Your nickname').fill(`Learner ${i + 1}`)
      await student.getByRole('button', { name: 'Join your team →' }).click()
      await expect(
        student.getByRole('heading', {
          name: 'You’re in. Get ready to learn.',
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
    await page.getByRole('button', { name: 'Start game', exact: true }).click()
    for (const student of students)
      await expect(
        student.page.getByRole('heading', {
          name: 'How many sides does a triangle have?',
        }),
      ).toBeVisible()
    await students[0].page.getByRole('button', { name: /A\s*Three/ }).click()
    await expect(students[0].page.getByText(/Answer saved/)).toBeVisible()
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
        name: '✓ Correct! Keep growing.',
      }),
    ).toBeVisible()
    expect(
      (await new AxeBuilder({ page: students[0].page }).analyze()).violations,
    ).toEqual([])
    await expect(
      students[1].page.getByRole('heading', { name: '↗ A chance to learn.' }),
    ).toBeVisible()
    await students[0].page.screenshot({
      path: 'test-results/student-feedback-mobile.png',
      fullPage: true,
    })
    const overflow = await students[0].page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
    await page.getByRole('button', { name: 'Finish game', exact: true }).click()
    await expect(
      students[0].page.getByRole('heading', {
        name: 'Look how much you explored.',
      }),
    ).toBeVisible()
    const downloading = students[0].page.waitForEvent('download')
    await students[0].page
      .getByRole('button', { name: 'Download my CSV' })
      .click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/grasp-.*\.csv/)
    await students[0].page.goto('/teacher')
    await expect(students[0].page).toHaveURL(/login/)
    expect(errors).toEqual([])
  } finally {
    for (const student of students) await student.context.close()
  }
})
