import React, { useCallback, useRef } from 'react'
import { File, Folder } from 'lucide-react'
import type { TreeNode } from './file-explorer-types'

export type InlineInput = {
  parentPath: string
  type: 'file' | 'folder' | 'rename'
  depth: number
  existingName?: string
  existingPath?: string
  operationOwner?: TreeNode['operationOwner']
}

export function InlineInputRow({
  depth,
  inlineInput,
  onSubmit,
  onCancel
}: {
  depth: number
  inlineInput: InlineInput
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitted = useRef(false)
  const focusSettled = useRef(false)
  const focusFrame = useRef<number | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refocusFrame = useRef<number | null>(null)
  const inlineInputKey = [
    inlineInput.type,
    inlineInput.parentPath,
    inlineInput.depth,
    inlineInput.existingPath ?? '',
    inlineInput.existingName ?? ''
  ].join('\0')

  const cancelRefocusFrame = useCallback((): void => {
    if (refocusFrame.current !== null) {
      cancelAnimationFrame(refocusFrame.current)
      refocusFrame.current = null
    }
  }, [])
  const scheduleInputRefocus = useCallback((): void => {
    cancelRefocusFrame()
    refocusFrame.current = requestAnimationFrame(() => {
      refocusFrame.current = null
      inputRef.current?.focus()
    })
  }, [cancelRefocusFrame])
  const clearInlineInputTimers = useCallback(() => {
    if (focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current)
      focusFrame.current = null
    }
    cancelRefocusFrame()
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current)
      blurTimeout.current = null
    }
    if (settleTimer.current) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
  }, [cancelRefocusFrame])
  const setInputRef = useCallback(
    (el: HTMLInputElement | null): void => {
      inputRef.current = el
      clearInlineInputTimers()
      if (!el) return
      submitted.current = false
      focusSettled.current = false
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null
        if (inputRef.current !== el) return
        el.focus()
        if (inlineInput.type === 'rename' && inlineInput.existingName) {
          const dotIndex = inlineInput.existingName.lastIndexOf('.')
          dotIndex > 0 ? el.setSelectionRange(0, dotIndex) : el.select()
        }
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null
          focusSettled.current = true
        }, 200)
      })
    }, [clearInlineInputTimers, inlineInput.existingName, inlineInput.type]
  )
  const clearBlurTimeout = useCallback(() => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current)
      blurTimeout.current = null
    }
  }, [])
  const submit = useCallback((value: string) => {
    if (submitted.current) return
    submitted.current = true
    clearBlurTimeout()
    onSubmit(value)
  }, [clearBlurTimeout, onSubmit])

  return (
    <div className="flex items-center w-full h-[26px] px-2 gap-1" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
      <span className="size-3 shrink-0" />
      {inlineInput.type === 'folder' ? <Folder className="size-3 shrink-0 text-muted-foreground" /> : <File className="size-3 shrink-0 text-muted-foreground" />}
      <input
        key={inlineInputKey}
        ref={setInputRef}
        className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none border border-ring rounded-sm px-1"
        defaultValue={inlineInput.type === 'rename' ? inlineInput.existingName : ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            clearBlurTimeout()
            submitted.current = true
            onCancel()
          }
        }}
        onFocus={clearBlurTimeout}
        onBlur={(event) => {
          if (!focusSettled.current) {
            scheduleInputRefocus()
            return
          }
          const value = event.currentTarget.value
          blurTimeout.current = setTimeout(() => {
            blurTimeout.current = null
            submit(value)
          }, 150)
        }}
      />
    </div>
  )
}
