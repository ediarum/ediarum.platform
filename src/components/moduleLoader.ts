import type { InjectionKey } from 'vue'

/** Loads an app's ES module by URL. Injectable so tests can provide fake modules. */
export type ModuleLoader = (url: string) => Promise<unknown>

export const MODULE_LOADER: InjectionKey<ModuleLoader> = Symbol('ep-module-loader')

export const defaultModuleLoader: ModuleLoader = (url) => import(/* @vite-ignore */ url)
