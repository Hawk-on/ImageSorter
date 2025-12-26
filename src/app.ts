import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

// Types
interface ImageInfo {
    path: string;
    filename: string;
    sizeBytes: number;
}

interface ScanResult {
    imageCount: number;
    totalSizeBytes: number;
    images: ImageInfo[];
}

// Declare the global Tauri object for dialog access
declare global {
    interface Window {
        __TAURI__: {
            dialog: {
                open: (options: {
                    directory?: boolean;
                    multiple?: boolean;
                    title?: string;
                }) => Promise<string | string[] | null>;
            };
        };
    }
}

// State
let currentImages: ImageInfo[] = [];

export function setupApp() {
    const selectFolderBtn = document.getElementById("select-folder");
    const statusText = document.getElementById("status-text");
    const dropZone = document.getElementById("drop-zone");

    selectFolderBtn?.addEventListener("click", async () => {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Velg mappe med bilder",
            });

            if (selected) {
                const path = Array.isArray(selected) ? selected[0] : selected;
                updateStatus(`Skanner mappe...`);
                await scanFolder(path);
            }
        } catch (error) {
            console.error("Feil ved valg av mappe:", error);
            updateStatus(`Feil ved valg av mappe: ${error}`);
        }
    });

    // Drag and drop handlers
    dropZone?.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone?.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone?.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        updateStatus("Dra-og-slipp støttes snart");
    });

    function updateStatus(message: string) {
        if (statusText) {
            statusText.textContent = message;
        }
    }

    async function scanFolder(path: string) {
        try {
            updateStatus("Skanner mappe...");
            const result = await invoke<ScanResult>("scan_folder", { path });

            currentImages = result.images;
            const sizeMB = (result.totalSizeBytes / 1024 / 1024).toFixed(2);
            updateStatus(`Fant ${result.imageCount} bilder (${sizeMB} MB)`);

            // Display the gallery
            displayGallery(result.images);
        } catch (error) {
            console.error("Feil ved skanning:", error);
            updateStatus(`Feil: ${error}`);
        }
    }

    function displayGallery(images: ImageInfo[]) {
        const app = document.getElementById("app");
        if (!app) return;

        // Remove existing gallery
        const existingGallery = document.getElementById("gallery-section");
        if (existingGallery) {
            existingGallery.remove();
        }

        if (images.length === 0) return;

        // Create gallery section
        const gallerySection = document.createElement("section");
        gallerySection.id = "gallery-section";
        gallerySection.className = "gallery-section";

        const galleryHeader = document.createElement("div");
        galleryHeader.className = "gallery-header";
        galleryHeader.innerHTML = `
      <h2>📷 Bilder (${images.length})</h2>
      <div class="gallery-controls">
        <button class="btn btn-secondary" id="select-all">Velg alle</button>
      </div>
    `;

        const gallery = document.createElement("div");
        gallery.className = "gallery-grid";

        images.forEach((img, index) => {
            const item = document.createElement("div");
            item.className = "gallery-item";
            item.dataset.index = String(index);

            const imgSrc = convertFileSrc(img.path);
            const sizeKB = (img.sizeBytes / 1024).toFixed(1);

            item.innerHTML = `
        <div class="gallery-item-image">
          <img src="${imgSrc}" alt="${img.filename}" loading="lazy" />
          <div class="gallery-item-overlay">
            <input type="checkbox" class="gallery-checkbox" data-path="${img.path}" />
          </div>
        </div>
        <div class="gallery-item-info">
          <span class="gallery-item-name" title="${img.filename}">${img.filename}</span>
          <span class="gallery-item-size">${sizeKB} KB</span>
        </div>
      `;

            // Toggle selection on click
            item.addEventListener("click", (e) => {
                if ((e.target as HTMLElement).tagName !== "INPUT") {
                    const checkbox = item.querySelector(".gallery-checkbox") as HTMLInputElement;
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        item.classList.toggle("selected", checkbox.checked);
                    }
                }
            });

            gallery.appendChild(item);
        });

        gallerySection.appendChild(galleryHeader);
        gallerySection.appendChild(gallery);

        // Insert after main container
        const container = app.querySelector(".container");
        if (container) {
            container.appendChild(gallerySection);
        }

        // Select all functionality
        document.getElementById("select-all")?.addEventListener("click", () => {
            const checkboxes = gallery.querySelectorAll(".gallery-checkbox") as NodeListOf<HTMLInputElement>;
            const allChecked = Array.from(checkboxes).every((cb) => cb.checked);

            checkboxes.forEach((cb) => {
                cb.checked = !allChecked;
                const item = cb.closest(".gallery-item");
                item?.classList.toggle("selected", cb.checked);
            });
        });
    }
}
