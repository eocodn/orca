import { defineMethod, type RpcMethod } from '../core'
import { MouseButton, MouseWheel, MouseXY, Viewport } from './browser-schemas'

export const BROWSER_EXTRA_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'browser.viewport',
    params: Viewport,
    handler: async (params, { runtime }) => runtime.browserSetViewport(params)
  }),
  defineMethod({
    name: 'browser.mouseMove',
    params: MouseXY,
    handler: async (params, { runtime }) => runtime.browserMouseMove(params)
  }),
  defineMethod({
    name: 'browser.mouseDown',
    params: MouseXY.merge(MouseButton),
    handler: async (params, { runtime }) => runtime.browserMouseDown(params)
  }),
  defineMethod({
    name: 'browser.mouseUp',
    params: MouseXY.merge(MouseButton),
    handler: async (params, { runtime }) => runtime.browserMouseUp(params)
  }),
  defineMethod({
    name: 'browser.mouseWheel',
    params: MouseXY.merge(MouseWheel),
    handler: async (params, { runtime }) => runtime.browserMouseWheel(params)
  }),
  defineMethod({
    name: 'browser.mouseClick',
    params: MouseButton.merge(MouseXY),
    handler: async (params, { runtime }) => runtime.browserMouseClick(params)
  })
]
