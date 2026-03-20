<div align="center">
  <img src="logo.png" alt="CoxOrb Data Visualiser Logo" width="800">
</div>

# CoxOrb Data Visualiser V2

**[Access the Web Application Here](https://nikjur.github.io/CoxOrbDataAnalyser/)**

A powerful, interactive web application designed to visualise and analyse rowing performance data. Entirely rebuilt using native web technologies (HTML, CSS, JavaScript), this tool combines GPS CoxOrb data (GPX) and performance metrics (CSV) into a seamless, client-side experience. All data processing occurres locally within the browser, ensuring zero server latency, instant updates, and complete data privacy for coxswains, coaches, and teams.

## Key Features
### 1. Route Visualisation

Upload GPX files to view the exact course steered on an interactive map.

- Dynamic Speed Gradient: The primary route features an optional heatmap toggle, visualising boat velocity by transitioning from red (slow) to green (fast). The algorithm automatically calculates and applies the 5th and 95th statistical percentiles to filter out stationary periods and GPS anomalies. Alternatively, manual thresholds can be set.

- Comparison Mode: Upload up to 5 different GPX tracks (e.g., different pieces or different days) to compare steering lines side-by-side (and make your trialling coxes' lives hell).

### 2. Performance Metrics

Upload CSV files (exported from CoxOrb or similar devices) to generate high-resolution, interactive charts.

- Metrics Supported: Stroke Rate, Split (s/500m), Speed (m/s), Distance Per Stroke, and Check. Toggle them on and off by clicking on the respective legend markers.

### 3. Interactive Replay & Master Timeline
Merge map and rowing data directly in the browser, letting you follow all essential metrics as you drag the slider.

- Synchronised View: A master timeline slider drives the entire interface. Scrubbing the timeline simultaneously updates the boat marker on the map and trackes the exact stroke on the performance chart.

- Live Dashboard: Real-time text metrics (Rate, Split, Distance) update continuously alongside the data progression.

### 4. Audio Analysis
Upload an audio recording (MP3/WAV) alongside your data.

- Auto-Sync: The application synchronises the audio playback with the boat's position on the map, ensuring the coxswain's calls matched the exact map position.

-Precision Controls: The custom audio interface includes +/- 10-second skip buttons and full keyboard shortcut integration (Spacebar to toggle playback, Left/Right arrows to skip).

### 5. Feedback
Found a bug or have a feature request? Use the Contact & Feedback form built directly into the bottom of the application! However, if you already find yourself on this GitHub repo - you might as well open an "issue", increasing your chances of a quick fix coming your way.

---
### Project Structure
- index.html: The structural foundation of the application, containing the map containers, dashboard layout, and custom UI components.

- style.css: The visual design system. Enforced the CoxOrb Data Visualiser aesthetics, utilising custom CSS variables, responsive flexbox grids, and the signature navy and orange colour palette.

- app.js: The central processing engine. Handles client-side file parsing (PapaParse), temporal mathematical synchronisation, Chart.js/Leaflet initialisation, interactive event listeners, and the JSON export pipeline.
---

## ⭐️ Support the Project (for free!)
If this tool enhances your coxing, coaching, or rowing analyses, please consider giving this repository a star ⭐️. It costs nothing, helps track community engagement, and encourages future development and updates. It also helps you find it again in a months time. :)