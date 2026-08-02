// Static WebView markup is split by document phase to keep the assembly module small.
import { terminalWebviewTemplateValues } from './terminal-webview-template-values'

export const terminal_webview_html_fragment_events = `
      var b = term.buffer.active;
      sel = {
        anchor: { col: 0, row: 0 },
        focus: { col: term.cols - 1, row: b.length - 1 },
        activeHandle: null
      };
      repositionOverlay();
    } catch (err) {}
  });

  var ts = {
    lastX: 0, lastY: 0, lastTime: 0, velY: 0,
    accumDelta: 0, momentumId: null, isPinching: false,
    pinchDist: 0, pinchScale: 0, pinchSurfX: 0, pinchSurfY: 0
  };

  function updateTouchVelocity(deltaY, dt) {
    if (dt <= 0) return;
    var instantVelocity = deltaY / dt;
    if (!isFinite(instantVelocity)) return;
    // Why: touchmove cadence is uneven in WebView. Blend recent samples so
    // momentum launch doesn't inherit a one-frame spike or stall.
    ts.velY = ts.velY === 0 ? instantVelocity : ts.velY * 0.55 + instantVelocity * 0.45;
  }

  function getDistance(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function attachSurfaceEventHandlers(targetSurface) {
    if (!targetSurface || targetSurface.__orcaSurfaceHandlersAttached) return;
    targetSurface.__orcaSurfaceHandlersAttached = true;
    // Why: init() swaps in a new hidden surface to avoid flicker; each
    // replacement needs gesture handlers or tab-switch replays stop scrolling.
    targetSurface.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
    targetSurface.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); }, true);

    attachSurfaceWheelHandler(targetSurface);
    attachSurfaceMouseClickDragHandler(targetSurface);

    targetSurface.addEventListener('touchstart', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (ts.momentumId) {
        cancelAnimationFrame(ts.momentumId);
        ts.momentumId = null;
      }
      if (e.touches.length === 2) {
        ts.isPinching = true;
        smoothScrollOffsetY = 0;
        ts.pinchDist = getDistance(e.touches[0], e.touches[1]);
        ts.pinchScale = userScale;
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        var total = getTotalScale();
        ts.pinchSurfX = (mx - panX) / total;
        ts.pinchSurfY = (my - panY) / total;
      } else if (e.touches.length === 1) {
        ts.isPinching = false;
        ts.lastX = e.touches[0].clientX;
        ts.lastY = e.touches[0].clientY;
        ts.lastTime = Date.now();
        ts.velY = 0;
        ts.accumDelta = 0;
      }
    }, { capture: true, passive: true });

    targetSurface.addEventListener('touchmove', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (!term) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.touches.length === 2) {
        ts.isPinching = true;
        var dist = getDistance(e.touches[0], e.touches[1]);
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        var ratio = dist / ts.pinchDist;
        // Why: userScale is a CSS multiplier on the current font size; bound it so
        // the resulting apparent size (currentTextScale × userScale) stays within
        // the preset range, since release snaps to one of those presets.
        var loScale = MIN_TEXT_SCALE / currentTextScale;
        var hiScale = MAX_TEXT_SCALE / currentTextScale;
        userScale = Math.max(loScale, Math.min(hiScale, ts.pinchScale * ratio));

        var total = getTotalScale();
        panX = mx - ts.pinchSurfX * total;
        panY = my - ts.pinchSurfY * total;
        clampPan();
        updateTransform();

      } else if (e.touches.length === 1 && !ts.isPinching) {
        var x = e.touches[0].clientX, y = e.touches[0].clientY;
        var now = Date.now(), dt = now - ts.lastTime;

        // Why: pan horizontally only when content overflows the viewport (larger
        // than fit) — same check clampPan() uses. Vertical always drives buffer
        // scroll so scrollback stays reachable at any text size; calling the
        // never-defined contentWiderThanViewport() here threw and killed all
        // single-finger scrolling, scrollback included.
        if (term.element && term.element.scrollWidth * getTotalScale() > window.innerWidth + 1) {
          panX += x - ts.lastX;
          clampPan();
          updateTransform();
        }

        var deltaY = ts.lastY - y;
        ts.lastTime = now;
        if (shouldRouteScrollToTerminalInput()) {
          updateTouchVelocity(deltaY, dt);
          resetSmoothScrollOffset();
          var effectiveCellH = getCellHeight() * getTotalScale();
          ts.accumDelta += deltaY;
          var lines = Math.trunc(ts.accumDelta / effectiveCellH);
          if (lines !== 0) {
            ts.accumDelta -= lines * effectiveCellH;
            routeScrollLines(lines, x, y);
          }
        } else {
          if (enqueueNormalBufferScrollDelta(deltaY)) {
            updateTouchVelocity(deltaY, dt);
          } else {
            ts.velY = 0;
          }
        }
        ts.lastX = x;
        ts.lastY = y;
      }
    }, { capture: true, passive: false });

    targetSurface.addEventListener('touchend', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (!term) return;

      if (ts.isPinching && e.touches.length < 2) {
        ts.isPinching = false;
        // Why: a finished pinch snaps to the nearest preset and becomes the new
        // font size (reflowing the grid), so pinch-to-zoom IS the in-terminal way
        // to set the text size. The CSS pinch zoom (userScale) is reset; the real
        // size change reflows columns and RN persists + resizes the PTY to match.
        var target = snapToTextScalePreset(currentTextScale * userScale);
        var changed = target !== currentTextScale;
        userScale = 1;
        panX = 0; panY = 0;
        applyTextScale(target);
        updateTransform();
        notify({ type: 'font-scale-changed', fontScale: target });
        if (changed) notify({ type: 'haptic', kind: 'selection' });
        if (e.touches.length === 1) {
          ts.lastX = e.touches[0].clientX;
          ts.lastY = e.touches[0].clientY;
          ts.lastTime = Date.now();
          ts.velY = 0;
          ts.accumDelta = 0;
        }
        return;
      }

      if (e.touches.length === 0) {
        var vel = ts.velY;
        var FRICTION = 0.972;
        var MIN_VEL = 0.012;
        function momentumStep() {
          vel *= FRICTION;
          if (Math.abs(vel) < MIN_VEL) { ts.momentumId = null; return; }
          var delta = vel * 16;
          if (shouldRouteScrollToTerminalInput()) {
            resetSmoothScrollOffset();
            var effectiveCellH = getCellHeight() * getTotalScale();
            ts.accumDelta += delta;
            var lines = Math.trunc(ts.accumDelta / effectiveCellH);
            if (lines !== 0) {
              ts.accumDelta -= lines * effectiveCellH;
              routeScrollLines(lines, ts.lastX, ts.lastY);
            }
          } else {
            if (!applyNormalBufferScrollDelta(delta)) {
              ts.momentumId = null;
              return;
            }
          }
          ts.momentumId = requestAnimationFrame(momentumStep);
        }
        if (Math.abs(vel) > MIN_VEL) {
          ts.momentumId = requestAnimationFrame(momentumStep);
        }
      }
    }, { capture: true, passive: true });
  }

  attachSurfaceEventHandlers(surface);

  function handleIncomingMessage(e) {
    var msg;
    try {
      msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch (ex) {
      return;
    }
    try {
      handleMsg(msg);
    } catch(ex) {
      reportEngineError(
        msg && msg.type === 'init' ? 'terminal init failed' : 'terminal message failed',
        ex,
        msg && msg.type === 'init' && !everReady
      );
    }
  }

  window.addEventListener('message', handleIncomingMessage);

  document.addEventListener('message', handleIncomingMessage);

  window.addEventListener('resize', function() {
    // Why: viewport changed (keyboard open/close, orientation, RN container
    // size update). Re-fit so the scale matches the new vpWidth — without
    // this, opening the keyboard leaves the terminal at the old scale even
    // though there's now less vertical room and the fit ratio may differ.
    applyFitScale('window-resize');
    adjustRowsForViewport();
    repositionOverlay();
    clampPan();
    updateTransform();
  });

  if (window.Terminal) {
    notify({ type: 'web-ready' });
  } else {
    reportEngineError('terminal engine missing', 'xterm failed to load', true);
  }
})();
</script>
</body>
</html>
`
