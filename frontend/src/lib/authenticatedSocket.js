// Authentication is refreshed for every handshake. The provider owns lifecycle;
// delayed auth callbacks must never reopen a socket after StrictMode cleanup.
export function authenticatedSocket(
  socket,
  accessToken,
  auth,
  onAuthError = () => {},
) {
  let active = false
  let generation = 0
  let subscription
  socket.auth = (callback) => {
    const attempt = generation
    accessToken()
      .then((token) => {
        if (active && generation === attempt) callback({ accessToken: token })
      })
      .catch(() => {
        if (active && generation === attempt) {
          socket.disconnect()
          onAuthError()
        }
      })
  }
  return {
    connect() {
      if (active) return
      active = true
      generation++
      subscription = auth.onAuthStateChange((event) => {
        if (
          active &&
          ['TOKEN_REFRESHED', 'SIGNED_OUT', 'SIGNED_IN'].includes(event)
        ) {
          // Defer SDK calls until after its auth callback releases the session lock.
          const attempt = ++generation
          setTimeout(() => {
            if (active && generation === attempt) {
              socket.disconnect()
              socket.connect()
            }
          })
        }
      }).data.subscription
      socket.connect()
    },
    disconnect() {
      active = false
      generation++
      subscription?.unsubscribe()
      subscription = undefined
      socket.disconnect()
    },
  }
}
