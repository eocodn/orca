// Notebook cell presentation and inline editor lifecycle for IpynbViewer.
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import DOMPurify from 'dompurify'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Braces,
  FileCode2,
  Loader2,
  MoveDown,
  MoveUp,
  Play,
  Trash2
} from 'lucide-react'
import { monaco } from '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { resolveDocumentTheme } from '@/lib/document-theme'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { type ShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { getIpynbCodeCellEditorHeight, getIpynbCodeCellPreviewLines } from './ipynb-code-cell-lines'
import MonacoCodeExcerpt from './MonacoCodeExcerpt'
import { type IpynbCell, type IpynbCellKind, type IpynbOutputItem } from './ipynb-parse'
import { translate } from '@/i18n/i18n'

function valueToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join('')
  }
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return ''
  }
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

function dataUriForImage(item: IpynbOutputItem): string | null {
  const value = valueToText(item.value).replace(/\s/g, '')
  if (!value) {
    return null
  }
  if (item.mime === 'image/svg+xml') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(valueToText(item.value))}`
  }
  return `data:${item.mime};base64,${value}`
}

function NotebookCellHeader({
  cell,
  index,
  running,
  canMoveUp,
  canMoveDown,
  onRun,
  onKindChange,
  onInsertAbove,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
  onDelete
}: {
  cell: IpynbCell
  index: number
  running: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onRun: () => void
  onKindChange: (kind: IpynbCellKind) => void
  onInsertAbove: (kind: IpynbCellKind) => void
  onInsertBelow: (kind: IpynbCellKind) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}): React.JSX.Element {
  const Icon = cell.kind === 'code' ? Play : cell.kind === 'markdown' ? FileCode2 : Braces
  const executionLabel = cell.kind === 'code' ? `In [${cell.executionCount ?? ' '}]:` : cell.kind
  return (
    <div className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      <span className="font-mono">{executionLabel}</span>
      <select
        value={cell.kind}
        onChange={(event) => onKindChange(event.target.value as IpynbCellKind)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        <option value="code">
          {translate('auto.components.editor.IpynbViewer.7005960d73', 'Code')}
        </option>
        <option value="markdown">
          {translate('auto.components.editor.IpynbViewer.1833dbbc43', 'Markdown')}
        </option>
        <option value="raw">
          {translate('auto.components.editor.IpynbViewer.3e4cbf15ea', 'Raw')}
        </option>
      </select>
      {cell.kind === 'code' ? (
        <NotebookHeaderButton
          label={translate('auto.components.editor.IpynbViewer.859bf9fc21', 'Run cell')}
          disabled={running}
          onClick={onRun}
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        </NotebookHeaderButton>
      ) : null}
      <NotebookHeaderButton
        label={translate('auto.components.editor.IpynbViewer.fd8ac707bc', 'Move cell up')}
        disabled={!canMoveUp}
        onClick={onMoveUp}
      >
        <MoveUp className="size-3.5" />
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate('auto.components.editor.IpynbViewer.27e064e2db', 'Move cell down')}
        disabled={!canMoveDown}
        onClick={onMoveDown}
      >
        <MoveDown className="size-3.5" />
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate('auto.components.editor.IpynbViewer.53b839b8a0', 'Insert code cell above')}
        onClick={() => onInsertAbove('code')}
      >
        <ArrowUpToLine className="size-3.5" />
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate('auto.components.editor.IpynbViewer.b4208cad7e', 'Insert code cell below')}
        onClick={() => onInsertBelow('code')}
      >
        <ArrowDownToLine className="size-3.5" />
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate(
          'auto.components.editor.IpynbViewer.ffc1ac2699',
          'Insert markdown cell above'
        )}
        onClick={() => onInsertAbove('markdown')}
      >
        <span className="relative size-4">
          <FileCode2 className="absolute left-0.5 top-0.5 size-3" />
          <MoveUp className="absolute -right-0.5 -top-0.5 size-2.5" />
        </span>
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate(
          'auto.components.editor.IpynbViewer.b42f6a9547',
          'Insert markdown cell below'
        )}
        onClick={() => onInsertBelow('markdown')}
      >
        <span className="relative size-4">
          <FileCode2 className="absolute left-0.5 top-0.5 size-3" />
          <MoveDown className="absolute -bottom-0.5 -right-0.5 size-2.5" />
        </span>
      </NotebookHeaderButton>
      <NotebookHeaderButton
        label={translate('auto.components.editor.IpynbViewer.781abd6926', 'Delete cell')}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </NotebookHeaderButton>
      <span className="ml-auto font-mono">#{index + 1}</span>
    </div>
  )
}

function NotebookHeaderButton({
  label,
  disabled = false,
  shortcut,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  shortcut?: ShortcutKeyComboDetails
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {shortcut && shortcut.keys.length > 0 ? (
            <ShortcutKeyCombo keys={shortcut.keys} doubleTap={shortcut.doubleTap} />
          ) : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function MarkdownCell({ source }: { source: string }): React.JSX.Element {
  return (
    <div className="markdown-preview-body px-4 py-3 text-sm">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
        {source || '\u00a0'}
      </Markdown>
    </div>
  )
}

function CodeCell({
  cell,
  source,
  active,
  onActivate,
  onDeactivate,
  onChange,
  onSaveRequest
}: {
  cell: IpynbCell
  source: string
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
  onChange: (source: string) => void
  onSaveRequest: () => Promise<void>
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const onDeactivateRef = useRef(onDeactivate)
  const onSaveRequestRef = useRef(onSaveRequest)
  // Why: Monaco commands/listeners are installed once on mount and need the
  // latest callbacks without rebuilding the embedded editor.
  onDeactivateRef.current = onDeactivate
  onSaveRequestRef.current = onSaveRequest
  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const editorHeight = getIpynbCodeCellEditorHeight(source, fontSize)
  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')
  const lines = useMemo(() => getIpynbCodeCellPreviewLines(source), [source])
  const handleMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorInstance.focus()
    const cleanupSaveShortcut = installEditorSaveShortcut(
      editorInstance.getContainerDomNode(),
      () => {
        void onSaveRequestRef.current()
      }
    )
    const cleanupFindShortcut = installMonacoEditorFindShortcut(editorInstance)
    const blurSub = editorInstance.onDidBlurEditorWidget(() => {
      onDeactivateRef.current()
    })
    editorInstance.onDidDispose(() => {
      // Why: the inline source editor owns its shortcut bridges and blur
      // subscription for the lifetime of this Monaco editor instance.
      cleanupSaveShortcut()
      cleanupFindShortcut()
      blurSub.dispose()
    })
    editorInstance.addCommand(monacoInstance.KeyCode.Escape, () => {
      onDeactivateRef.current()
    })
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }, [isDark])

  if (!active) {
    return (
      <div
        role="button"
        tabIndex={0}
        className="block w-full cursor-text bg-editor-surface text-left"
        onClick={onActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onActivate()
          }
        }}
      >
        <MonacoCodeExcerpt
          lines={lines}
          firstLineNumber={1}
          highlightedStartLine={-1}
          highlightedEndLine={-1}
          language={cell.language}
        />
      </div>
    )
  }

  return (
    <div className="bg-editor-surface focus-within:ring-1 focus-within:ring-ring">
      <Editor
        height={editorHeight}
        defaultLanguage={cell.language}
        language={cell.language}
        theme={isDark ? 'vs-dark' : 'vs'}
        value={source}
        onMount={handleMount}
        onChange={(value) => onChange(value ?? '')}
        options={{
          automaticLayout: true,
          fontFamily: resolveEditorFontFamily(settings),
          fontSize,
          glyphMargin: false,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          wordWrap: 'off'
        }}
      />
    </div>
  )
}

const MemoizedCodeCell = React.memo(CodeCell)

function getCellKey(cell: IpynbCell, index: number): string {
  return cell.id ?? `${index}:${cell.kind}`
}

function hasOwnDraft(drafts: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, key)
}

function EditableTextCell({
  source,
  onChange
}: {
  source: string
  onChange: (source: string) => void
}): React.JSX.Element {
  return (
    <textarea
      value={source}
      onChange={(event) => onChange(event.target.value)}
      className="block min-h-24 w-full resize-y border-0 bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function PreformattedOutput({
  text,
  error = false
}: {
  text: string
  error?: boolean
}): React.JSX.Element {
  return (
    <pre
      className={cn(
        'max-h-[420px] overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5 scrollbar-editor',
        error ? 'text-destructive' : 'text-foreground'
      )}
    >
      {text}
    </pre>
  )
}

function OutputItem({ item }: { item: IpynbOutputItem }): React.JSX.Element | null {
  if (item.mime === 'text/html') {
    const html = DOMPurify.sanitize(valueToText(item.value), {
      USE_PROFILES: { html: true, svg: true, svgFilters: true }
    })
    return (
      <iframe
        title={translate('auto.components.editor.IpynbViewer.66a3f7d330', 'Notebook HTML output')}
        sandbox=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className="block h-80 w-full border-0 bg-background"
        srcDoc={html}
      />
    )
  }

  if (item.mime.startsWith('image/')) {
    const uri = dataUriForImage(item)
    if (!uri) {
      return null
    }
    return (
      <div className="flex max-w-full overflow-auto p-3 scrollbar-editor">
        <img src={uri} alt={item.mime} className="max-h-[520px] max-w-full object-contain" />
      </div>
    )
  }

  if (item.mime === 'application/json' || item.mime.endsWith('+json')) {
    const text =
      typeof item.value === 'string' ? item.value : JSON.stringify(item.value ?? null, null, 2)
    return <PreformattedOutput text={text} />
  }

  if (item.mime === 'text/markdown') {
    return <MarkdownCell source={valueToText(item.value)} />
  }

  if (item.mime.startsWith('text/') || item.mime === 'application/javascript') {
    return <PreformattedOutput text={valueToText(item.value)} />
  }

  return null
}

function CellOutputs({ cell }: { cell: IpynbCell }): React.JSX.Element | null {
  if (cell.outputs.length === 0) {
    return null
  }

  return (
    <div className="border-t border-border/50 bg-background">
      {cell.outputs.map((output, index) => {
        if (output.kind === 'stream') {
          return <PreformattedOutput key={index} text={output.text} />
        }
        if (output.kind === 'error') {
          return (
            <div key={index} className="border-l-2 border-destructive">
              <PreformattedOutput
                error
                text={[output.name, output.message, output.traceback].filter(Boolean).join('\n')}
              />
            </div>
          )
        }
        const renderedItems = output.items
          .map((item, itemIndex) => <OutputItem key={`${item.mime}-${itemIndex}`} item={item} />)
          .filter(Boolean)
        if (renderedItems.length === 0) {
          return null
        }
        return (
          <div key={index} className="border-b border-border/40 last:border-b-0">
            {renderedItems}
          </div>
        )
      })}
    </div>
  )
}


export {
  CellOutputs,
  EditableTextCell,
  getCellKey,
  hasOwnDraft,
  MarkdownCell,
  MemoizedCodeCell,
  NotebookCellHeader
}
