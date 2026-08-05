// Static WebView markup is split by document phase to keep the assembly module small.
import { terminalWebviewTemplateValues } from './terminal-webview-template-values'

export const terminal_webview_html_fragment_style = `
  function snapToTextScalePreset(value) {
    var best = TEXT_SCALE_PRESETS[0], bestDelta = Infinity;
    for (var i = 0; i < TEXT_SCALE_PRESETS.length; i++) {
      var delta = Math.abs(TEXT_SCALE_PRESETS[i] - value);
      if (delta < bestDelta) { bestDelta = delta; best = TEXT_SCALE_PRESETS[i]; }
    }
    return best;
  }
  function fontPxForScale(scale) {
    return Math.max(MIN_FONT_PX, Math.round(BASE_FONT_PX * scale));
  }
  var terminalFontFamily = '"Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Symbols Nerd Font Mono", monospace';
  // Why: change the real font size, then resize the grid to fit the viewport at
  // the new cell metrics so the text shows at its true size immediately. RN's
  // refit (measure → updateViewport) then makes the server reflow the PTY to the
  // same column count so the shell rewraps. cell metrics update on the frame
  // after fontSize changes, so the resize/fit is deferred one rAF.
  function applyTextScale(scale) {
    currentTextScale = scale;
    if (!term) return;
    var px = fontPxForScale(scale);
    if (term.options.fontSize === px) return;
    term.options.fontSize = px;
    requestAnimationFrame(function() {
      if (!term) return;
      var cellW = getCellWidth();
      var cellH = getCellHeight();
      if (cellW > 0 && cellH > 0) {
        var cols = Math.floor(window.innerWidth / cellW);
        if (cols < MIN_FIT_COLS) return;
        var rows = Math.max(8, Math.floor(window.innerHeight / cellH));
        term.resize(cols, rows);
      }
      applyFitScale('text-scale');
    });
  }
  var panX = 0, panY = 0;
  var smoothScrollOffsetY = 0;
  var pendingNormalScrollDeltaY = 0;
  var normalScrollFrameId = null;
  var initRows = 24;
  var terminalGeneration = 0;
  var defaultTheme = ${JSON.stringify(terminalWebviewTemplateValues.DEFAULT_TERMINAL_THEME)};
  var terminalThemeInput = null;
  var terminalTheme = defaultTheme;
  var terminalMinimumContrastRatio = 3;
  var webglAddon = null;
  var webglRecoveryTimer = null;
  var activeAltScreenSnapshot = false;
  var trackedMouseTrackingMode = 'none';
  var sgrMouseMode = false;
  var sgrMousePixelsMode = false;
  var initialOscLinks = [], initialOscLinkRowOffset = 0;
  var initialOscLinkEvictionReady = false;
  var mouseModeScanTail = '';
  var handledMessageIds = [];
  // Why: after init() the initial scrollback applyFitScale may have run
  // against an empty buffer (or one without the widest line yet). Re-fit
  // once when the first live data chunk arrives so a wider line that pushes
  // scrollWidth past the previously-measured value gets re-scaled to fit.
  var firstDataPending = false;

  // Diagnostic logger — bridges WebView console.log to RN via postMessage.
  // Tag with [fit] so it's easy to filter in the Expo/Metro logs.
  function flog(tag, payload) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'log', tag: '[fit]' + tag, payload: payload
        }));
      }
    } catch (e) {}
  }

  function getCellWidth() {
    if (!term || !term._core) return 0;
    var core = term._core;
    if (core._renderService && core._renderService.dimensions) {
      return core._renderService.dimensions.css.cell.width || 0;
    }
    return 0;
  }

  // Why: width measurement strategy.
  //   1. Prefer cellWidth × term.cols — this is what xterm's renderer uses
  //      to lay out and is independent of buffer content. It's the "logical
  //      width" of the terminal grid.
  //   2. Fall back to term.element.scrollWidth — the actual rendered DOM
  //      width — only when cellWidth isn't available yet (renderer not
  //      initialized). This is content-dependent (reflects widest row),
  //      but better than nothing.
  //   3. If both are 0, return 1 (no scale change). The retry loop in
  //      applyFitScale will keep trying until one is positive.
  function computeFitScale() {
    if (!term) return 1;
    var cellW = getCellWidth();
    var termWidth = cellW > 0 ? cellW * term.cols : (term.element ? term.element.scrollWidth : 0);
    if (termWidth <= 0) return 1;
    var vpWidth = window.innerWidth;
    return Math.min(1, vpWidth / termWidth);
  }

  function getTotalScale() { return currentScale * userScale; }

  function updateTransform() {
    surface.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + getTotalScale() + ')';
    updateScrollIndicator(false);
    if (selMode === 'select') repositionOverlay();
  }

  function updateScrollIndicator(reveal) {
    if (!scrollIndicator || !scrollThumb || !term || !term.buffer || !term.buffer.active) return;
    var buffer = term.buffer.active;
    var maxViewportY = buffer.baseY || 0;
    if (maxViewportY <= 0 || shouldRouteScrollToTerminalInput()) {
      scrollIndicator.classList.remove('visible');
      return;
    }
    var trackHeight = Math.max(0, window.innerHeight - 8);
    var totalRows = maxViewportY + (term.rows || 0);
    if (trackHeight <= 0 || totalRows <= 0) return;
    var thumbHeight = Math.max(24, trackHeight * (term.rows || 0) / totalRows);
    var maxTop = Math.max(0, trackHeight - thumbHeight);
    var top = maxViewportY > 0 ? (buffer.viewportY / maxViewportY) * maxTop : 0;
    scrollThumb.style.height = thumbHeight + 'px';
    scrollThumb.style.transform = 'translateY(' + top + 'px)';
    if (!reveal) return;
    scrollIndicator.classList.add('visible');
    if (scrollIndicatorHideTimer) clearTimeout(scrollIndicatorHideTimer);
    scrollIndicatorHideTimer = setTimeout(function() {
      scrollIndicator.classList.remove('visible');
      scrollIndicatorHideTimer = null;
    }, 550);
  }

${terminalWebviewTemplateValues.TERMINAL_WEBVIEW_THEME_JS}

  function getCellHeight() {
    if (!term || !term._core) return 15;
    var core = term._core;
    if (core._renderService && core._renderService.dimensions) {
      return core._renderService.dimensions.css.cell.height || 15;
    }
    return 15;
  }

  // Why: clamp pan so the terminal content always covers the viewport
  // when zoomed in. When content is smaller than viewport in a
  // dimension, pin to top-left (no floating in the middle).
  function clampPan() {
    if (!term || !term.element) return;
    var ts = getTotalScale();
    var cw = term.element.scrollWidth * ts;
    var ch = term.element.scrollHeight * ts;
    var vpW = window.innerWidth;
    var vpH = window.innerHeight;
    if (cw > vpW) {
      panX = Math.min(0, Math.max(vpW - cw, panX));
    } else {
      panX = 0;
    }
    if (ch > vpH) {
      panY = Math.min(0, Math.max(vpH - ch, panY));
    } else {
      panY = 0;
    }
  }

  // Why: intentional no-op. Mobile replays a live PTY snapshot then applies
  // live cursor-relative chunks from that same PTY; resizing only the WebView
  // xterm changes cursor coordinates and makes TUI repaint chunks duplicate or
  // overlap. Kept as a no-op so its call sites stay legible.
  function adjustRowsForViewport() {}

  // Why: cold-start fit. After init() opens xterm, the renderer needs
  // several frames before cell dimensions are computed. Reading too early
  // gives cellWidth=0 (renderer service not ready) or scrollWidth=0 (DOM
  // not laid out), and computeFitScale returns 1 → no zoom.
  //
  // Gate: cellWidth × cols is the canonical "logical width" of the grid
  // and reflects xterm's layout decision, independent of buffer content.
  // We commit when cellWidth becomes positive (renderer ready). Fallback:
  // if cellWidth never becomes available, gate on stable positive
  // scrollWidth (xterm rendered something). Cap at 60 frames (~1s @60Hz)
  // so a backgrounded WebView never spins forever.
  var FIT_RETRY_MAX_FRAMES = 60;
  var fitRetryToken = 0;
  function applyFitScale(reason) {
    if (!term || !term.element) return;
    var token = ++fitRetryToken;
    var attempts = 0;
    var lastScrollWidth = -1;
    function attempt() {
`
