// Frontend-specific types

export interface AppError {
  code: string
  message: string
  details?: unknown
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: AppError | null
}
