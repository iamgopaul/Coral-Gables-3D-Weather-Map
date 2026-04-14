/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_OPENWEATHERMAP_API_KEY?: string;
    readonly VITE_ARCGIS_API_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
