import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
    // Vite options tailored for Tauri development
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        watch: {
            // watch the src-tauri directory
            ignored: ["!**/src-tauri/**"],
        },
    },
});
