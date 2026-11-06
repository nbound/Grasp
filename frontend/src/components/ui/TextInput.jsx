export function TextInput({ id, label, error, hint, ...props }) {
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') ||
    undefined
  return (
    <div className="grasp-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <small className="grasp-muted" id={`${id}-hint`}>
          {hint}
        </small>
      )}
      <input
        id={id}
        className="grasp-input"
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...props}
      />
      {error && (
        <small className="grasp-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  )
}
