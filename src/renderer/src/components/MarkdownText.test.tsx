import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MarkdownText from './MarkdownText'

describe('MarkdownText', () => {
  beforeEach(() => {
    global.window.open = vi.fn()
  })

  it('renders plain text unchanged', () => {
    const { container } = render(<MarkdownText text="hello world" />)
    expect(container.textContent).toBe('hello world')
  })

  it('renders bold text with **syntax**', () => {
    const { container } = render(<MarkdownText text="**bold**" />)
    const strong = container.querySelector('strong')
    expect(strong).toBeTruthy()
    expect(strong?.textContent).toBe('bold')
  })

  it('renders italic text with *syntax*', () => {
    const { container } = render(<MarkdownText text="*italic*" />)
    const em = container.querySelector('em')
    expect(em).toBeTruthy()
    expect(em?.textContent).toBe('italic')
  })

  it('renders underline text with __syntax__', () => {
    const { container } = render(<MarkdownText text="__underline__" />)
    const u = container.querySelector('u')
    expect(u).toBeTruthy()
    expect(u?.textContent).toBe('underline')
  })

  it('renders https links as clickable', async () => {
    const { container } = render(<MarkdownText text="[label](https://example.com)" />)
    const link = container.querySelector('a')
    expect(link).toBeTruthy()
    expect(link?.textContent).toBe('label')
    expect(link?.className).toBe('md-link')

    await userEvent.click(link!)
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')
  })

  it('renders http links as clickable', async () => {
    const { container } = render(<MarkdownText text="[click](http://example.com)" />)
    const link = container.querySelector('a')

    await userEvent.click(link!)
    expect(window.open).toHaveBeenCalledWith('http://example.com', '_blank')
  })

  it('does not linkify non-http URLs', () => {
    const { container } = render(<MarkdownText text="[bad](ftp://example.com)" />)
    const link = container.querySelector('a')
    expect(link).toBeNull()
    // Text should contain the raw markdown
    expect(container.textContent).toContain('[bad](ftp://example.com)')
  })

  it('preserves newlines in output', () => {
    const { container } = render(<MarkdownText text="line1\nline2\nline3" />)
    // The output should contain all three lines, separated by br elements
    // jsdom's textContent will show newlines where br elements are
    expect(container.textContent).toContain('line1')
    expect(container.textContent).toContain('line2')
    expect(container.textContent).toContain('line3')
  })

  it('mixes bold and italic in same line', () => {
    const { container } = render(<MarkdownText text="**bold** and *italic*" />)
    const strong = container.querySelector('strong')
    const em = container.querySelector('em')
    expect(strong?.textContent).toBe('bold')
    expect(em?.textContent).toBe('italic')
  })

  it('prevents default and does not navigate on link click', async () => {
    const { container } = render(<MarkdownText text="[link](https://example.com)" />)
    const link = container.querySelector('a') as HTMLAnchorElement

    await userEvent.click(link)

    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')
  })

  it('wraps result in a span element', () => {
    const { container } = render(<MarkdownText text="test" />)
    const span = container.querySelector('span')
    expect(span).toBeTruthy()
    expect(span?.textContent).toBe('test')
  })

  it('accepts and applies className prop', () => {
    const { container } = render(<MarkdownText text="test" className="my-class" />)
    const span = container.querySelector('span')
    expect(span?.className).toBe('my-class')
  })
})
