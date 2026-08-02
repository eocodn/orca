// Static WebView markup is split by document phase to keep the assembly module small.
import { terminalWebviewTemplateValues } from './terminal-webview-template-values'

export const terminal_webview_html_fragment_bootstrap = `
      if (token !== fitRetryToken) return;
      if (!term || !term.element) return;
      attempts++;
      var cellW = getCellWidth();
      if (cellW > 0 && term.cols > 0) {
        commitFitScale(reason, attempts, 'cellW');
        return;
      }
      var w = term.element.scrollWidth;
      if (w > 0 && w === lastScrollWidth) {
        commitFitScale(reason, attempts, 'stableSW');
        return;
      }
      lastScrollWidth = w;
      if (attempts >= FIT_RETRY_MAX_FRAMES) {
        flog('commit-timeout', {
          reason: reason,
          attempts: attempts,
          cellW: cellW,
          scrollWidth: w,
          cols: term.cols
        });
        commitFitScale(reason, attempts, 'timeout');
        return;
      }
      requestAnimationFrame(attempt);
    }
    requestAnimationFrame(attempt);
  }

  function commitFitScale(reason, attempts, gate) {
    if (!term || !term.element) return;
    var preSnapScale = computeFitScale();
    currentScale = preSnapScale;
    // Why: when scale is very close to 1 (e.g. 0.97 from xterm scrollbar
    // sub-pixels) snap to 1 to avoid imperceptible shrinkage that prevents
    // a second applyFitScale from observing a "no-op needed" state.
    if (currentScale >= 0.95) currentScale = 1;
    userScale = 1;
    panX = 0;
    panY = 0;
    smoothScrollOffsetY = 0;
    updateTransform();
    adjustRowsForViewport();

    var cellW = getCellWidth();
    var sw = term.element.scrollWidth;
    var vpW = window.innerWidth;
    var expectedW = cellW * term.cols;
    var suspect =
      currentScale === 1 && term.cols > 0 && expectedW > vpW + 1; // expected wider than viewport but no zoom
    if (suspect) {
      flog('commit-SUSPECT', {
        reason: reason,
        attempts: attempts,
        gate: gate,
        preSnapScale: preSnapScale,
        finalScale: currentScale,
        cellW: cellW,
        cols: term.cols,
        expectedW: expectedW,
        scrollWidth: sw,
        vpWidth: vpW
      });
    }
    repositionOverlay();
  }

  function isAltScreenActive(data) {
    if (typeof data !== 'string') return false;
    var on = data.lastIndexOf(ESC + '[?1049h');
    var off = data.lastIndexOf(ESC + '[?1049l');
    return on !== -1 && on > off;
  }

  function normalizeInitialData(data) {
    if (!isAltScreenActive(data)) return data;
    var on = data.lastIndexOf(ESC + '[?1049h');
    // Why: SerializeAddon can include normal-buffer scrollback before the
    // active alternate-screen snapshot. Replaying both into a fresh mobile
    // xterm duplicates TUI frames and can flatten SGR attributes.
    return on > 0 ? data.slice(on) : data;
  }

  function updateMouseModeFromData(data) {
    if (typeof data !== 'string' || data.length === 0) return;
    var input = mouseModeScanTail + data;
    mouseModeScanTail = extractMouseModeScanTail(input);
    var re = new RegExp(ESC + 'c|' + ESC + '\\\\[\\\\?([0-9;]+)([hl])|' + C1_CSI + '\\\\?([0-9;]+)([hl])', 'g');
    var match;
    while ((match = re.exec(input)) !== null) {
      if (match[0] === ESC + 'c') {
        trackedMouseTrackingMode = 'none';
        sgrMouseMode = false;
        sgrMousePixelsMode = false;
        continue;
      }
      var enabled = (match[2] || match[4]) === 'h';
      var params = (match[1] || match[3]).split(';');
      for (var i = 0; i < params.length; i++) {
        if (params[i] === '') continue;
        var param = Number(params[i]);
        if (!Number.isInteger(param)) continue;
        if (param === 9) trackedMouseTrackingMode = enabled ? 'x10' : 'none';
        if (param === 1000) trackedMouseTrackingMode = enabled ? 'vt200' : 'none';
        if (param === 1002) trackedMouseTrackingMode = enabled ? 'drag' : 'none';
        if (param === 1003) trackedMouseTrackingMode = enabled ? 'any' : 'none';
        if (param === 1006) {
          sgrMouseMode = enabled;
          sgrMousePixelsMode = false;
        }
        if (param === 1016) {
          sgrMouseMode = false;
          sgrMousePixelsMode = enabled;
        }
      }
    }
  }

  function resetWriteQueue() {
    writeQueue = [];
    writeQueueHead = 0;
  }

  function isStatusDotPresentationSelector(value) {
    return value === TEXT_PRESENTATION_SELECTOR || value === EMOJI_PRESENTATION_SELECTOR;
  }

  function endsWithStatusDotPresentationSequence(data) {
    var i = data.length - 1;
    while (i >= 0 && isStatusDotPresentationSelector(data.charAt(i))) i--;
    return i >= 0 && data.charAt(i) === CLAUDE_STATUS_DOT;
  }

  // Why: iOS WebKit promotes Claude's record/status dot to a colorful emoji glyph.
  function normalizeStatusDotPresentation(data) {
    if (typeof data !== 'string' || data.length === 0) return data;
    if (statusDotPendingSelector) {
      statusDotPendingSelector = false;
      var strippedPendingSelectors = false;
      while (data.length > 0 && isStatusDotPresentationSelector(data.charAt(0))) data = data.slice(1);
      strippedPendingSelectors = data.length === 0;
      if (strippedPendingSelectors) {
        statusDotPendingSelector = true;
        return '';
      }
    }
    var normalized = data.replace(CLAUDE_STATUS_DOT_PATTERN, CLAUDE_STATUS_DOT + TEXT_PRESENTATION_SELECTOR);
    statusDotPendingSelector = endsWithStatusDotPresentationSequence(data);
    return normalized;
  }

  function enqueueWrite(data) {
    writeQueue.push(normalizeStatusDotPresentation(data));
  }

  function enqueueWriteBoundary(callback) {
    writeQueue.push(callback);
  }

  function nextQueuedWrite() {
    if (writeQueueHead >= writeQueue.length) {
      resetWriteQueue();
      return undefined;
    }
    var next = writeQueue[writeQueueHead];
    writeQueueHead++;
    // Why: high-throughput terminals can enqueue faster than xterm parses;
    // compact consumed slots so drain work stays O(1) without retaining old chunks.
    if (writeQueueHead > 128 && writeQueueHead * 2 > writeQueue.length) {
      writeQueue = writeQueue.slice(writeQueueHead);
      writeQueueHead = 0;
    }
    return next;
  }

  function disposeTermObservers() {
    var disposables = termObserverDisposables;
    termObserverDisposables = [];
    for (var i = 0; i < disposables.length; i++) {
      try { disposables[i] && disposables[i].dispose && disposables[i].dispose(); } catch (e) {}
    }
  }

  function extractMouseModeScanTail(input) {
    var start = Math.max(input.lastIndexOf(ESC), input.lastIndexOf(C1_CSI));
    if (start === -1) return '';
    var tail = input.slice(start);
    // Why: PTY/SSH chunks can split a long combined DECSET before the final h/l.
    // Keep parser state far beyond normal mode lists while still bounding memory.
    if (tail.length > PRIVATE_MODE_SCAN_TAIL_LIMIT) return '';
    if (tail === ESC || tail === ESC + '[' || tail === C1_CSI) return tail;
    if (tail.indexOf(ESC + '[?') === 0) {
      return /^[0-9;]*$/.test(tail.slice(3)) ? tail : '';
    }
    if (tail.indexOf(C1_CSI + '?') === 0) {
      return /^[0-9;]*$/.test(tail.slice(2)) ? tail : '';
    }
    return '';
  }
`
