export function Card({ children, ...props }) {
  return (
    <section className="grasp-card" {...props}>
      {children}
    </section>
  )
}
