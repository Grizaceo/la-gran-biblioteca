/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_TARGET?: string
  readonly VITE_LGB_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
