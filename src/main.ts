import { setupApp } from "./app";
import "./styles/main.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="container">
    <header class="header">
      <h1>🖼️ ImageSorter</h1>
      <p class="subtitle">Sorter bilder og finn duplikater</p>
    </header>

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
