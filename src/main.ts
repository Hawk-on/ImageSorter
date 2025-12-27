import { setupApp } from "./app";
import "./styles/main.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="container">
    <header class="header" id="main-header">
      <h1>🛡️ Heimdall Sort</h1>
      <p class="subtitle">Sorter bilder og finn duplikater</p>
    </header>

    <div id="toolbar-container" class="toolbar hidden">
        <button class="btn btn-secondary btn-sm" id="change-folder-btn">📁 Bytt mappe</button>
        <span id="folder-path-display" class="folder-path"></span>
    </div>

    <main class="main">
      <section class="drop-zone" id="drop-zone">
        <div class="drop-zone-content">
          <span class="drop-icon">📁</span>
          <p>Dra og slipp en mappe her</p>
          <p class="drop-hint">eller</p>
          <button class="btn btn-primary" id="select-folder">Velg mappe</button>
        </div>
      </section>

      <section class="status-panel" id="status-panel">
        <div class="status-content">
          <p id="status-text">Velg en mappe for å starte</p>
        </div>
      </section>
    </main>
  </div>
`;

setupApp();
