import React from 'react'
import { useTabBarController, type TabBarProps } from './tab-bar-controller'
import { TabBarView } from './tab-bar-view'

export type { TabBarProps } from './tab-bar-controller'

function TabBarSurface(props: TabBarProps): React.JSX.Element {
  const controller = useTabBarController(props)
  return TabBarView({ props, controller })
}

export default React.memo(TabBarSurface)
