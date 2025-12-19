# TypeScript Code Style Guide

## General Rules
- Use TypeScript strict mode
- Prefer `const` over `let`, avoid `var`
- Use explicit return types for functions
- No semicolons
- 2-space indentation
- Trailing commas in multi-line arrays/objects

## Naming Conventions
- `camelCase` for variables, functions, and methods
- `PascalCase` for types, interfaces, classes, and components
- `SCREAMING_SNAKE_CASE` for constants
- Prefix interfaces with `I` only when necessary for disambiguation
- Use descriptive names over abbreviations

## Imports
```typescript
// Order: external packages, then internal modules, then relative imports
// Separate groups with blank lines
import React from 'react'
import { useEffect } from 'react'

import { AgentSession } from 'claude-agent-loop'

import { AuthStorage } from './auth-storage'
import type { AuthConfig } from './types'
```

## Types
```typescript
// Prefer type aliases for unions/intersections
type Status = 'idle' | 'loading' | 'error'

// Use interfaces for object shapes that may be extended
interface MessageProps {
  content: string
  role: 'user' | 'assistant'
}

// Avoid `any`, use `unknown` when type is truly unknown
// Use explicit error types
function parse(input: unknown): Result<Data, ParseError>
```

## Functions
```typescript
// Explicit return types
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}

// Arrow functions for callbacks
const filtered = items.filter((item) => item.active)

// Prefer async/await over .then chains
async function fetchData(): Promise<Data> {
  const response = await fetch(url)
  return response.json()
}
```

## React Components
```typescript
// Functional components with explicit types
interface ButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function Button({ label, onClick, disabled = false }: ButtonProps): JSX.Element {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
```

## Error Handling
```typescript
// Use Result types for expected errors
type Result<T, E> = { ok: true, value: T } | { ok: false, error: E }

// Use try/catch for unexpected errors
try {
  await riskyOperation()
} catch (error) {
  if (error instanceof SpecificError) {
    handleSpecific(error)
  } else {
    throw error
  }
}
```

## Avoid
- `any` type (use `unknown` or proper types)
- Non-null assertions (`!`) without justification
- Implicit return types on public APIs
- Magic numbers/strings (use named constants)
- Nested ternaries
- Side effects in pure functions
