import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

interface OperationResult {
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

const DUPLICATE_THRESHOLD = 5; // For 8x8 hash (64 bits), 5 er god balanse

// State
let currentImages: ImageInfo[] = [];
// Virutell scroll state
let virtualState = {
    rowHeight: 200, // Estimat, oppdateres dynamisk
    containerHeight: 0,
    scrollTop: 0,
    cols: 4,
    totalRows: 0,
    startIndex: 0,
    endIndex: 0
};
// Cache for valgte bilder (siden DOM elementer slettes)
let selectedPaths: Set<string> = new Set();

let scrollContent: HTMLDivElement | null = null;
let spacer: HTMLDivElement | null = null;
let scrollContainer: HTMLDivElement | null = null;

export function setupApp() {
    const toolbar = document.getElementById("toolbar-container");
    const changeFolderBtn = document.getElementById("change-folder-btn");
    const selectFolderBtn = document.getElementById("select-folder");
    const dropZone = document.getElementById("drop-zone");
    const statusText = document.getElementById("status-text");

    // Helper to toggle views
    const toggleView = (mode: 'import' | 'gallery') => {
        if (!dropZone || !toolbar) return;

        if (mode === 'import') {
            dropZone.style.display = 'flex';
            toolbar.classList.add('hidden');
            document.getElementById("gallery-section")?.remove();
            document.getElementById("duplicate-section")?.remove();
            currentImages = [];
        } else {
            dropZone.style.display = 'none';
            toolbar.classList.remove('hidden');
        }
    };

    selectFolderBtn?.addEventListener("click", async () => {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Velg mappe med bilder",
            });

            if (selected) {
                const path = Array.isArray(selected) ? selected[0] : selected;
                // Vis path i toolbar
                const pathDisplay = document.getElementById("folder-path-display");
                if (pathDisplay) pathDisplay.textContent = path;

                toggleView('gallery');
                updateStatus("Skanner mappe...");
                await scanFolder(path);
            }
        } catch (error) {
            console.error("Feil ved valg av mappe:", error);
            updateStatus(`Feil ved valg av mappe: ${error}`);
            toggleView('import');
        }
    });

    changeFolderBtn?.addEventListener("click", () => {
        toggleView('import');
        updateStatus("Velg en mappe for å starte");
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
            // Nullstill state
            selectedPaths.clear();

            scrollContent = null;
            spacer = null;
            scrollContainer = null;
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

            let processedCount = 0;
            const unlisten = await listen("progress", () => {
                processedCount++;
                updateStatus(`Analyserer ${processedCount}/${paths.length} bilder...`);
            });

            const result = await invoke<DuplicateResult>("find_duplicates", {
                paths,
                threshold: DUPLICATE_THRESHOLD,
            });

            unlisten();

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
            const result = await invoke<OperationResult>("sort_images_by_date", {
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

    async function deleteSelected() {
        const selected = getSelectedImages();
        if (selected.length === 0) {
            alert("Ingen bilder valgt");
            return;
        }

        if (!confirm(`Er du sikker på at du vil slette ${selected.length} bilder? De flyttes til papirkurven hvis mulig.`)) {
            return;
        }

        const btn = document.getElementById("delete-selected");
        try {
            btn?.classList.add("loading");
            const paths = selected.map(img => img.path);
            const result = await invoke<OperationResult>("delete_images", { paths });

            let msg = `Slettet ${result.success} bilder.`;
            if (result.errors > 0) msg += ` ${result.errors} feil (se logg).`;

            updateStatus(msg);
            alert(msg);

            // Fjern slettede bilder fra UI
            if (result.success > 0) {
                // Vi antar her at suksess betyr at bildene er borte.
                // For en mer robust løsning burde backend returnere liste over slettede stier.
                // Men for MVP reloader vi bare mappen eller fjerner de valgte optimistisk.
                // Optimistisk fjerning:
                currentImages = currentImages.filter(img => !paths.includes(img.path));
                initGallery();
            }

        } catch (error) {
            console.error("Feil ved sletting:", error);
            alert(`Feil ved sletting: ${error}`);
        } finally {
            btn?.classList.remove("loading");
        }
    }

    async function moveSelected() {
        const selected = getSelectedImages();
        if (selected.length === 0) {
            alert("Ingen bilder valgt");
            return;
        }

        try {
            const targetDir = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: "Velg målmappe for flytting",
            });

            if (!targetDir) return;
            const targetPath = Array.isArray(targetDir) ? targetDir[0] : targetDir;

            const btn = document.getElementById("move-selected");
            btn?.classList.add("loading");
            updateStatus(`Flytter ${selected.length} bilder...`);

            const paths = selected.map(img => img.path);
            const result = await invoke<OperationResult>("move_images", { paths, targetDir: targetPath });

            let msg = `Flyttet ${result.success} bilder.`;
            if (result.errors > 0) msg += ` ${result.errors} feil.`;

            updateStatus(msg);
            alert(msg);

            if (result.success > 0) {
                currentImages = currentImages.filter(img => !paths.includes(img.path));
                initGallery();
            }

        } catch (error) {
            console.error("Feil ved flytting:", error);
            alert(`Feil ved flytting: ${error}`);
        } finally {
            document.getElementById("move-selected")?.classList.remove("loading");
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

        // Virtual Scroll Container
        scrollContainer = document.createElement("div");
        scrollContainer.className = "virtual-scroll-container";

        // Spacer (gir scrollbar riktig høyde)
        spacer = document.createElement("div");
        spacer.className = "virtual-scroll-spacer";
        scrollContainer.appendChild(spacer);

        // Content (holder de synlige elementene)
        scrollContent = document.createElement("div");
        scrollContent.className = "virtual-scroll-content";
        scrollContainer.appendChild(scrollContent);

        gallerySection.appendChild(galleryHeader);
        gallerySection.appendChild(scrollContainer);

        const container = app.querySelector(".container");
        if (container) {
            container.appendChild(gallerySection);
        }

        // Attach listeners
        document.getElementById("find-duplicates")?.addEventListener("click", findDuplicates);
        document.getElementById("sort-images")?.addEventListener("click", sortImages);
        document.getElementById("select-all")?.addEventListener("click", toggleSelectAll);
        document.getElementById("delete-selected")?.addEventListener("click", deleteSelected);
        document.getElementById("move-selected")?.addEventListener("click", moveSelected);

        // Init virtual scroll
        setupVirtualScroll();
    }

    function setupVirtualScroll() {
        if (!scrollContainer || !spacer || !scrollContent) return;

        // 1. Beregn grid-dimensjoner
        const calculateMetrics = () => {
            if (!scrollContainer) return;
            const containerWidth = scrollContainer.clientWidth;
            // Min bredde 160px + gap 16px (var(--spacing-md))
            const minColWidth = 160 + 16;
            virtualState.cols = Math.max(1, Math.floor((containerWidth - 32) / minColWidth)); // 32px padding
            virtualState.totalRows = Math.ceil(currentImages.length / virtualState.cols);

            // Sync CSS grid columns force-match JS logic
            scrollContent?.style.setProperty('--grid-cols', String(virtualState.cols));

            // Beregn row height dynamisk
            // Bredde på grid-item = (containerWidth - padding - (cols-1)*gap) / cols
            // Padding = 32px (var(--spacing-xl) = 2rem = 32px, men container padding er kanskje ikke relevant for grid width?)
            // Grid container padding er --spacing-sm (8px)
            // La oss måle faktisk bredde på column via CSS logikk
            const gap = 16;
            const padding = 16; // left+right
            const availableWidth = containerWidth - padding;
            const colWidth = (availableWidth - (virtualState.cols - 1) * gap) / virtualState.cols;

            // Høyde = colWidth (aspect-ratio: 1) + infoDel (ca 50px) + gap
            virtualState.rowHeight = colWidth + 50 + gap;

            // Oppdater høyde på spacer
            const totalHeight = virtualState.totalRows * virtualState.rowHeight;
            if (spacer) spacer.style.height = `${totalHeight}px`;

            virtualState.containerHeight = scrollContainer.clientHeight;
        };

        // Resize Observer
        const resizeObserver = new ResizeObserver(() => {
            calculateMetrics();
            renderVirtualItems();
        });
        resizeObserver.observe(scrollContainer);

        // Scroll listener
        scrollContainer.addEventListener("scroll", (e) => {
            requestAnimationFrame(() => {
                virtualState.scrollTop = (e.target as HTMLElement).scrollTop;
                renderVirtualItems();
            });
        });

        // Initial calculering
        calculateMetrics();
        renderVirtualItems();
    }

    function renderVirtualItems() {
        if (!scrollContent || !currentImages.length) return;

        // Beregn synlige rader
        const startRow = Math.floor(virtualState.scrollTop / virtualState.rowHeight);
        const visibleRows = Math.ceil(virtualState.containerHeight / virtualState.rowHeight);

        // Legg til buffer (1 rad over/under)
        const buffer = 2;
        const startRowWithBuffer = Math.max(0, startRow - buffer);
        let endRowWithBuffer = startRow + visibleRows + buffer;
        endRowWithBuffer = Math.min(endRowWithBuffer, virtualState.totalRows);

        const newStartIndex = startRowWithBuffer * virtualState.cols;
        const newEndIndex = Math.min(endRowWithBuffer * virtualState.cols, currentImages.length);

        // Hvis ingen endring i indeks, ikke gjør noe (unngå unødvendig DOM-manipulasjon)
        if (newStartIndex === virtualState.startIndex && newEndIndex === virtualState.endIndex) {
            return;
        }

        virtualState.startIndex = newStartIndex;
        virtualState.endIndex = newEndIndex;

        // Posisjoner content-diven
        const offsetY = startRowWithBuffer * virtualState.rowHeight;
        scrollContent.style.transform = `translateY(${offsetY}px)`;

        // Tøm og fyll på nytt (enkel tilnærming, kan optimaliseres med gjenbruk)
        scrollContent.innerHTML = "";

        const visibleImages = currentImages.slice(newStartIndex, newEndIndex);

        const fragment = document.createDocumentFragment();
        visibleImages.forEach((img, i) => {
            const actualIndex = newStartIndex + i;
            fragment.appendChild(createGalleryItem(img, actualIndex));
        });
        scrollContent.appendChild(fragment);

        // Oppdater telling i header
        const headerTitle = document.querySelector("#gallery-header h2");
        if (headerTitle) {
            headerTitle.textContent = `📷 Bilder (${currentImages.length} totalt)`;
        }
    }

    function updateGalleryHeader(header: HTMLElement) {
        header.innerHTML = `
      <h2>📷 Bilder (${currentImages.length})</h2>
      <div class="gallery-controls">
        <button class="btn btn-accent" id="find-duplicates">🔍 Finn duplikater</button>
        <button class="btn btn-primary" id="sort-images">📂 Sorter Alt</button>
        <div class="divider"></div>
        <button class="btn btn-secondary" id="select-all">Velg alle</button>
        <button class="btn btn-danger" id="delete-selected">🗑️ Slett valgte</button>
        <button class="btn btn-secondary" id="move-selected">➡️ Flytt valgte</button>
      </div>
    `;
    }

    function toggleSelectAll() {
        if (selectedPaths.size === currentImages.length) {
            selectedPaths.clear();
        } else {
            currentImages.forEach(img => selectedPaths.add(img.path));
        }
        renderVirtualItems(); // Re-render for å vise checkboxes
    }

    function getSelectedImages(): ImageInfo[] {
        return currentImages.filter(img => selectedPaths.has(img.path));
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
      <div class="duplicate-controls">
          <button class="btn btn-danger" id="delete-duplicates-btn">🗑️ Slett valgte duplikater</button>
          <button class="btn btn-secondary" id="close-duplicates">✕ Lukk</button>
      </div>
    `;

        // Skjul hovedgalleri
        const gallerySection = document.getElementById("gallery-section");
        if (gallerySection) gallerySection.style.display = "none";

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
            // Vis hovedgalleri igjen
            if (gallerySection) gallerySection.style.display = "block";
        });

        document.getElementById("delete-duplicates-btn")?.addEventListener("click", async () => {
            const checkboxes = section.querySelectorAll(".gallery-checkbox:checked") as NodeListOf<HTMLInputElement>;
            const selectedPaths = Array.from(checkboxes).map(cb => cb.dataset.path).filter(p => p !== undefined) as string[];

            if (selectedPaths.length === 0) {
                alert("Ingen duplikater valgt");
                return;
            }

            if (!confirm(`Vil du slette ${selectedPaths.length} duplikater?`)) return;

            try {
                const result = await invoke<OperationResult>("delete_images", { paths: selectedPaths });

                let msg = `Slettet ${result.success} duplikater.`;
                if (result.errors > 0) msg += ` ${result.errors} feil.`;
                alert(msg);

                // Fjern slettede elementer fra DOM
                selectedPaths.forEach(path => {
                    const item = section.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
                    item?.remove();
                });

                // Sjekk om grupper er tomme
                section.querySelectorAll(".duplicate-group").forEach(group => {
                    if (group.querySelectorAll(".gallery-item").length < 2) {
                        // Hvis bare 1 (original) eller 0 igjen, fjern gruppen??
                        // Bruker vil kanskje beholde originalen i visningen til de lukker?
                        // La oss la dem stå, men kanskje markere at gruppen er løst.
                    }
                });

            } catch (error) {
                console.error("Feil ved sletting av duplikater:", error);
                alert(`Feil: ${error}`);
            }
        });
    }

    function createGalleryItem(img: ImageInfo, index: number): HTMLDivElement {
        const item = document.createElement("div");
        item.className = "gallery-item";
        item.dataset.index = String(index);
        item.dataset.path = img.path;

        const sizeKB = (img.sizeBytes / 1024).toFixed(1);

        // Lagre referanse til checkbox for å slippe querySelector
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "gallery-checkbox";
        checkbox.dataset.path = img.path;

        // Sjekk om valgt i persisted state
        if (selectedPaths.has(img.path)) {
            checkbox.checked = true;
            item.classList.add("selected");
        }

        item.innerHTML = `
      <div class="gallery-item-image">
        <div class="thumbnail-placeholder"></div>
        <img src="" alt="${img.filename}" style="display: none;" />
        <div class="gallery-item-overlay">
        </div>
      </div>
      <div class="gallery-item-info">
        <span class="gallery-item-name" title="${img.filename}">${img.filename}</span>
        <span class="gallery-item-size">${sizeKB} KB</span>
      </div>
    `;
        item.querySelector(".gallery-item-overlay")?.appendChild(checkbox);

        // Last thumbnail asynkront
        loadThumbnail(item, img.path);

        // Enkeltklikk = velg/avvelg
        item.addEventListener("click", (e) => {
            // Hvis klikk ikke var på checkbox (checkbox håndterer seg selv), toggle manuelt
            if ((e.target as HTMLElement) !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }
            // Oppdater state
            if (checkbox.checked) {
                selectedPaths.add(img.path);
                item.classList.add("selected");
            } else {
                selectedPaths.delete(img.path);
                item.classList.remove("selected");
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
