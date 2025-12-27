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

interface DuplicateGroup {
    images: ImageInfo[];
}

interface DuplicateResult {
    groups: DuplicateGroup[];
    totalDuplicates: number;
    processed: number;
    errors: number;
}

interface SortResult {
    processed: number;
    success: number;
    errors: number;
    errorMessages: string[];
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

// Configuration
const IMAGES_PER_PAGE = 50;
const DUPLICATE_THRESHOLD = 5; // For 8x8 hash (64 bits), 5 er god balanse

// State
let currentImages: ImageInfo[] = [];
let visibleCount = IMAGES_PER_PAGE;
let galleryElement: HTMLDivElement | null = null;

export function setupApp() {
    const selectFolderBtn = document.getElementById("select-folder");
    const changeFolderBtn = document.getElementById("change-folder");
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
                updateStatus("Skanner mappe...");
                await scanFolder(path);
            }
        } catch (error) {
            console.error("Feil ved valg av mappe:", error);
            updateStatus(`Feil ved valg av mappe: ${error}`);
        }
    });

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

    // Bytt mappe - utvid drop-zone igjen
    changeFolderBtn?.addEventListener("click", async () => {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Velg mappe med bilder",
            });

            if (selected) {
                const path = Array.isArray(selected) ? selected[0] : selected;
                updateStatus("Skanner mappe...");
                await scanFolder(path);
            }
        } catch (error) {
            console.error("Feil ved valg av mappe:", error);
            updateStatus(`Feil ved valg av mappe: ${error}`);
        }
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
            visibleCount = IMAGES_PER_PAGE;
            galleryElement = null;
            const sizeMB = (result.totalSizeBytes / 1024 / 1024).toFixed(2);
            updateStatus(`Fant ${result.imageCount} bilder (${sizeMB} MB)`);

            // Kollaps drop-zone
            if (dropZone) {
                dropZone.classList.add("collapsed");
                const content = dropZone.querySelector(".drop-zone-content") as HTMLElement;
                if (content) content.style.display = "none";
                if (changeFolderBtn) changeFolderBtn.style.display = "flex";
            }

            initGallery();
        } catch (error) {
            console.error("Feil ved skanning:", error);
            updateStatus(`Feil: ${error}`);
        }
    }

    async function findDuplicates() {
        if (currentImages.length === 0) {
            updateStatus("Velg en mappe først");
            return;
        }

        const btn = document.getElementById("find-duplicates");
        try {
            btn?.classList.add("loading");
            updateStatus(`Analyserer ${currentImages.length} bilder...`);

            const paths = currentImages.map((img) => img.path);
            const result = await invoke<DuplicateResult>("find_duplicates", {
                paths,
                threshold: DUPLICATE_THRESHOLD,
            });

            if (result.totalDuplicates === 0) {
                updateStatus(`Ingen duplikater funnet (${result.processed} bilder)`);
            } else {
                updateStatus(
                    `Fant ${result.totalDuplicates} duplikater i ${result.groups.length} grupper`
                );
                displayDuplicates(result.groups);
            }

            if (result.errors > 0) {
                console.warn(`${result.errors} bilder kunne ikke behandles`);
            }
        } catch (error) {
            console.error("Feil ved duplikatdeteksjon:", error);
            updateStatus(`Feil: ${error}`);
        } finally {
            btn?.classList.remove("loading");
        }
    }

    function createSortDialog(): Promise<{ confirmed: boolean; useDayFolder: boolean; useMonthNames: boolean } | null> {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <h3>Sorteringsvalg</h3>
                    </div>
                    <div class="modal-content">
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="sort-day-folder">
                                Opprett mappe for hver dag (År/Måned/Dag)
                            </label>
                        </div>
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="sort-month-names" checked>
                                Bruk månedsnavn (01 - Januar)
                            </label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="modal-cancel">Avbryt</button>
                        <button class="btn btn-primary" id="modal-confirm">Start Sortering (Kopier)</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Animate in
            requestAnimationFrame(() => overlay.classList.add("open"));

            const close = () => {
                overlay.classList.remove("open");
                setTimeout(() => overlay.remove(), 300);
            };

            document.getElementById("modal-cancel")?.addEventListener("click", () => {
                close();
                resolve(null);
            });

            document.getElementById("modal-confirm")?.addEventListener("click", () => {
                const useDayFolder = (document.getElementById("sort-day-folder") as HTMLInputElement).checked;
                const useMonthNames = (document.getElementById("sort-month-names") as HTMLInputElement).checked;
                close();
                resolve({ confirmed: true, useDayFolder, useMonthNames });
            });
        });
    }

    async function sortImages() {
        if (currentImages.length === 0) {
            updateStatus("Ingen bilder å sortere");
            return;
        }

        try {
            // 1. Velg målmappe
            const targetDir = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Velg målmappe for sortering",
            });

            if (!targetDir) return;

            const targetPath = Array.isArray(targetDir) ? targetDir[0] : targetDir;

            // 2. Vis opsjoner dialog
            const options = await createSortDialog();
            if (!options || !options.confirmed) return;

            updateStatus("Sorterer bilder (Kopierer)...");
            const btn = document.getElementById("sort-images");
            btn?.classList.add("loading");

            // 3. Utfør sortering med opsjoner
            const paths = currentImages.map((img) => img.path);
            const result = await invoke<SortResult>("sort_images_by_date", {
                paths,
                method: "copy",
                targetDir: targetPath,
                options: {
                    useDayFolder: options.useDayFolder,
                    useMonthNames: options.useMonthNames
                }
            });

            // 4. Vis resultat
            let message = `Sortering ferdig: ${result.success} kopiert, ${result.errors} feil.`;
            if (result.errors > 0) {
                console.warn("Feil under sortering:", result.errorMessages);
                message += " Sjekk konsoll for detaljer.";
            }
            updateStatus(message);
            alert(message);

        } catch (error) {
            console.error("Feil ved sortering:", error);
            updateStatus(`Feil ved sortering: ${error}`);
        } finally {
            document.getElementById("sort-images")?.classList.remove("loading");
        }
    }

    function initGallery() {
        const app = document.getElementById("app");
        if (!app) return;

        // Clean up
        document.getElementById("gallery-section")?.remove();
        document.getElementById("duplicate-section")?.remove();

        if (currentImages.length === 0) return;

        const gallerySection = document.createElement("section");
        gallerySection.id = "gallery-section";
        gallerySection.className = "gallery-section";

        // Header
        const galleryHeader = document.createElement("div");
        galleryHeader.className = "gallery-header";
        galleryHeader.id = "gallery-header";
        updateGalleryHeader(galleryHeader);

        // Gallery grid
        galleryElement = document.createElement("div");
        galleryElement.id = "gallery-grid";
        galleryElement.className = "gallery-grid";

        // Add initial images
        const visibleImages = currentImages.slice(0, visibleCount);
        visibleImages.forEach((img, index) => {
            galleryElement!.appendChild(createGalleryItem(img, index));
        });

        gallerySection.appendChild(galleryHeader);
        gallerySection.appendChild(galleryElement);

        // Load more container
        const loadMoreContainer = document.createElement("div");
        loadMoreContainer.className = "load-more-container";
        loadMoreContainer.id = "load-more-container";
        updateLoadMoreButton(loadMoreContainer);
        gallerySection.appendChild(loadMoreContainer);

        const container = app.querySelector(".container");
        if (container) {
            container.appendChild(gallerySection);
        }

        // Event listeners
        // Event listeners
        document.getElementById("find-duplicates")?.addEventListener("click", findDuplicates);
        document.getElementById("sort-images")?.addEventListener("click", sortImages);
        document.getElementById("select-all")?.addEventListener("click", toggleSelectAll);
    }

    function updateGalleryHeader(header: HTMLElement) {
        header.innerHTML = `
      <h2>📷 Bilder (${Math.min(visibleCount, currentImages.length)}/${currentImages.length})</h2>
      <div class="gallery-controls">
        <button class="btn btn-accent" id="find-duplicates">🔍 Finn duplikater</button>
        <button class="btn btn-primary" id="sort-images">📂 Sorter</button>
        <button class="btn btn-secondary" id="select-all">Velg alle</button>
      </div>
    `;
    }

    function updateLoadMoreButton(container: HTMLElement) {
        const remaining = currentImages.length - visibleCount;
        if (remaining > 0) {
            container.innerHTML = `
        <button class="btn btn-secondary" id="load-more">
          Last inn flere (${remaining} gjenstår)
        </button>
      `;
            document.getElementById("load-more")?.addEventListener("click", loadMore);
        } else {
            container.innerHTML = "";
        }
    }

    function loadMore() {
        if (!galleryElement) return;

        const startIndex = visibleCount;
        visibleCount = Math.min(visibleCount + IMAGES_PER_PAGE, currentImages.length);
        const endIndex = visibleCount;

        // Add only new images (no flicker)
        const newImages = currentImages.slice(startIndex, endIndex);
        newImages.forEach((img, i) => {
            galleryElement!.appendChild(createGalleryItem(img, startIndex + i));
        });

        // Update header and load more button
        const header = document.getElementById("gallery-header");
        if (header) updateGalleryHeader(header);

        const loadMoreContainer = document.getElementById("load-more-container");
        if (loadMoreContainer) updateLoadMoreButton(loadMoreContainer);

        // Re-attach event listeners
        // Re-attach event listeners
        document.getElementById("find-duplicates")?.addEventListener("click", findDuplicates);
        document.getElementById("sort-images")?.addEventListener("click", sortImages);
        document.getElementById("select-all")?.addEventListener("click", toggleSelectAll);
    }

    function toggleSelectAll() {
        if (!galleryElement) return;
        const checkboxes = galleryElement.querySelectorAll(".gallery-checkbox") as NodeListOf<HTMLInputElement>;
        const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
        checkboxes.forEach((cb) => {
            cb.checked = !allChecked;
            cb.closest(".gallery-item")?.classList.toggle("selected", cb.checked);
        });
    }

    function displayDuplicates(groups: DuplicateGroup[]) {
        const app = document.getElementById("app");
        if (!app) return;

        document.getElementById("duplicate-section")?.remove();

        const section = document.createElement("section");
        section.id = "duplicate-section";
        section.className = "duplicate-section";

        const header = document.createElement("div");
        header.className = "gallery-header";
        header.innerHTML = `
      <h2>🔍 Duplikatgrupper (${groups.length})</h2>
      <button class="btn btn-secondary" id="close-duplicates">✕ Lukk</button>
    `;

        section.appendChild(header);

        groups.forEach((group, groupIndex) => {
            const groupDiv = document.createElement("div");
            groupDiv.className = "duplicate-group";

            const groupHeader = document.createElement("div");
            groupHeader.className = "duplicate-group-header";
            groupHeader.textContent = `Gruppe ${groupIndex + 1} (${group.images.length} bilder)`;

            const groupGrid = document.createElement("div");
            groupGrid.className = "duplicate-grid";

            group.images.forEach((img, imgIndex) => {
                const item = createGalleryItem(img, imgIndex);
                if (imgIndex === 0) {
                    item.classList.add("original");
                } else {
                    item.classList.add("duplicate");
                }
                groupGrid.appendChild(item);
            });

            groupDiv.appendChild(groupHeader);
            groupDiv.appendChild(groupGrid);
            section.appendChild(groupDiv);
        });

        const container = app.querySelector(".container");
        if (container) {
            container.appendChild(section);
        }

        // Scroll til duplikater
        section.scrollIntoView({ behavior: "smooth", block: "start" });

        document.getElementById("close-duplicates")?.addEventListener("click", () => {
            section.remove();
        });
    }

    function createGalleryItem(img: ImageInfo, index: number): HTMLDivElement {
        const item = document.createElement("div");
        item.className = "gallery-item";
        item.dataset.index = String(index);
        item.dataset.path = img.path;

        const sizeKB = (img.sizeBytes / 1024).toFixed(1);

        // Start med placeholder, last thumbnail asynkront
        item.innerHTML = `
      <div class="gallery-item-image">
        <div class="thumbnail-placeholder">⏳</div>
        <img src="" alt="${img.filename}" loading="lazy" decoding="async" style="display: none;" />
        <div class="gallery-item-overlay">
          <input type="checkbox" class="gallery-checkbox" data-path="${img.path}" />
        </div>
      </div>
      <div class="gallery-item-info">
        <span class="gallery-item-name" title="${img.filename}">${img.filename}</span>
        <span class="gallery-item-size">${sizeKB} KB</span>
      </div>
    `;

        // Last thumbnail asynkront
        loadThumbnail(item, img.path);

        // Enkeltklikk = velg/avvelg
        item.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).tagName !== "INPUT") {
                const checkbox = item.querySelector(".gallery-checkbox") as HTMLInputElement;
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    item.classList.toggle("selected", checkbox.checked);
                }
            }
        });

        // Dobbeltklikk = åpne i standard app
        item.addEventListener("dblclick", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                await invoke("open_image", { path: img.path });
            } catch (error) {
                console.error("Kunne ikke åpne bilde:", error);
            }
        });

        return item;
    }

    async function loadThumbnail(item: HTMLDivElement, imagePath: string) {
        try {
            console.log("Loading thumbnail for:", imagePath);
            const thumbnailPath = await invoke<string>("get_thumbnail", { path: imagePath });
            console.log("Thumbnail path received:", thumbnailPath);

            const imgElement = item.querySelector("img") as HTMLImageElement;
            const placeholder = item.querySelector(".thumbnail-placeholder") as HTMLElement;

            if (imgElement && thumbnailPath) {
                const src = convertFileSrc(thumbnailPath);
                console.log("Converted src:", src);
                imgElement.src = src;
                imgElement.style.display = "block";
                if (placeholder) placeholder.style.display = "none";
            }
        } catch (error) {
            console.error("Thumbnail error for", imagePath, ":", error);
            // Fallback til original bilde ved feil
            const imgElement = item.querySelector("img") as HTMLImageElement;
            const placeholder = item.querySelector(".thumbnail-placeholder") as HTMLElement;

            if (imgElement) {
                imgElement.src = convertFileSrc(imagePath);
                imgElement.style.display = "block";
                if (placeholder) placeholder.style.display = "none";
            }
        }
    }
}
