import { createContext, useContext } from 'react'

export const StudentContext = createContext(null)
export function useStudent() {
  const value = useContext(StudentContext)
  if (!value) throw new Error('Student pages require StudentProvider')
  return value
}
