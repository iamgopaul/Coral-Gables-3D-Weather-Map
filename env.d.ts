/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_OPENWEATHERMAP_API_KEY?: string;
    readonly VITE_ARCGIS_API_KEY?: string;
    /** Optional — appended to NWS `User-Agent` for api.weather.gov (recommended for production). */
    readonly VITE_NWS_CONTACT_EMAIL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
