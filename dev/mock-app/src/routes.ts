import type { InjectionKey } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { MountContext } from '../../../src/contract'
import MockPage from './MockPage.vue'

export const CONTEXT: InjectionKey<MountContext> = Symbol('mock-ctx')

/** The app's content, independent of how it is mounted. */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'first', component: MockPage, props: { title: 'First page', other: 'second' } },
  { path: '/second', name: 'second', component: MockPage, props: { title: 'Second page', other: 'first' } },
  {
    path: '/item/:id',
    name: 'item',
    component: MockPage,
    props: (route) => ({ title: `Item ${String(route.params.id)}`, other: 'first' }),
  },
  { path: '/:pathMatch(.*)*', component: MockPage, props: { title: 'Mock app: unknown page', other: 'first' } },
]
