// Serialize initial sign-in so StrictMode/reconnect cannot create duplicate guests.
export function createStudentAuth(supabase) {
  let pending
  return async function accessToken() {
    if (!pending) {
      pending = (async () => {
        const { data, error } = await supabase.auth.getSession()
        if (error)
          throw new Error('Unable to restore your sign-in. Please try again.')
        if (data.session) return data.session.access_token
        const signed = await supabase.auth.signInAnonymously()
        if (signed.error || !signed.data.session) {
          throw new Error('Unable to sign in as a guest. Please try again.')
        }
        return signed.data.session.access_token
      })().finally(() => {
        pending = undefined
      })
    }
    return pending
  }
}
