export function validateJoin(values) {
  const pin = typeof values?.pin === 'string' ? values.pin.trim() : ''
  const nickname =
    typeof values?.nickname === 'string' ? values.nickname.trim() : ''
  const errors = {}
  if (!/^\d{6}$/.test(pin))
    errors.pin = 'Enter the 6-digit PIN from your teacher.'
  if (
    [...nickname].length < 2 ||
    [...nickname].length > 24 ||
    [...nickname].some(
      (character) =>
        character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  ) {
    errors.nickname =
      'Use a nickname with 2–24 characters and no control characters.'
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { pin, nickname },
  }
}
