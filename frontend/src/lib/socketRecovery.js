// Middleware refusals do not trigger Socket.IO's built-in transport retries.
export function socketRecovery(
  socket,
  schedule = setTimeout,
  cancel = clearTimeout,
) {
  let timer,
    attempts = 0,
    closed = false
  const clear = () => {
    cancel(timer)
    timer = undefined
  }
  const connected = () => {
    clear()
    attempts = 0
  }
  const failed = () => {
    if (closed || socket.active || timer !== undefined || attempts >= 5) return
    timer = schedule(
      () => {
        timer = undefined
        if (!closed && !socket.connected) socket.connect()
      },
      Math.min(2000 * 2 ** attempts++, 30000),
    )
  }
  socket.on('connect', connected)
  socket.on('connect_error', failed)
  socket.on('disconnect', failed)
  return {
    retry() {
      if (closed) return
      connected()
      socket.disconnect().connect()
    },
    close() {
      closed = true
      clear()
      socket.off('connect', connected)
      socket.off('connect_error', failed)
      socket.off('disconnect', failed)
    },
  }
}
