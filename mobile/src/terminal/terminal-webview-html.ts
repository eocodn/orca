import { MOBILE_TERMINAL_CARET_OPTIONS } from './terminal-webview-template-values'
import { terminal_webview_html_fragment_head } from './terminal-webview-html-fragment-head'
import { terminal_webview_html_fragment_style } from './terminal-webview-html-fragment-style'
import { terminal_webview_html_fragment_bootstrap } from './terminal-webview-html-fragment-bootstrap'
import { terminal_webview_html_fragment_terminal } from './terminal-webview-html-fragment-terminal'
import { terminal_webview_html_fragment_interaction } from './terminal-webview-html-fragment-interaction'
import { terminal_webview_html_fragment_selection } from './terminal-webview-html-fragment-selection'
import { terminal_webview_html_fragment_pointer } from './terminal-webview-html-fragment-pointer'
import { terminal_webview_html_fragment_input } from './terminal-webview-html-fragment-input'
import { terminal_webview_html_fragment_events } from './terminal-webview-html-fragment-events'

export { MOBILE_TERMINAL_CARET_OPTIONS }

// Keep fragment order explicit: WebView behavior depends on the original document phases.
export const XTERM_HTML = [
  terminal_webview_html_fragment_head,
  terminal_webview_html_fragment_style,
  terminal_webview_html_fragment_bootstrap,
  terminal_webview_html_fragment_terminal,
  terminal_webview_html_fragment_interaction,
  terminal_webview_html_fragment_selection,
  terminal_webview_html_fragment_pointer,
  terminal_webview_html_fragment_input,
  terminal_webview_html_fragment_events
].join('')

export const XTERM_WEBVIEW_SOURCE = { html: XTERM_HTML }
