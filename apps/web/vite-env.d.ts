/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PORT?: string;
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
