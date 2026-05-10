import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('smoke: renderer test env', () => {
  it('renders a React element into jsdom', () => {
    render(<div>hello</div>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
