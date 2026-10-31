export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`grasp-button grasp-button--${variant} ${className}`}
      {...props}
    />
  )
}
