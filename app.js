/**
 * Global State Variables
 * Holds the parsed datasets and the instances for the map and chart.
 */
let gpxData = [];
let csvData = [];
let mergedData = [];
let mapInstance = null;
let boatMarker = null;
let chartInstance = null;

// DOM Elements
const processBtn = document.getElementById('process-btn');
const replaySection = document.getElementById('replay-section');
const timeSlider = document.getElementById('time-slider');
const audioUpload = document.getElementById('audio-upload');
const audioPlayer = document.getElementById('audio-player');
const audioContainer = document.getElementById('audio-container');

/**
 * Event Listener for the main processing button.
 * Triggers the parsing of uploaded files.
 */
processBtn.addEventListener('click', async () => {
    const gpxFile = document.getElementById('gpx-upload').files[0];
    const csvFile = document.getElementById('csv-upload').files[0];

    if (!gpxFile || !csvFile) {
        alert("Please upload both GPX and CSV files.");
        return;
    }

    try {
        processBtn.innerText = "Processing...";
        
        // Read files asynchronously
        const gpxText = await readFileAsText(gpxFile);
        const csvText = await readFileAsText(csvFile);

        // Parse extracted texts
        gpxData = parseGPX(gpxText);
        csvData = parseCSV(csvText);

        // DEGBUGGING for GPX CSV merging - log first few entries to verify parsing
        console.log("GPX Sample:", gpxData.slice(0, 3));
        console.log("CSV Sample:", csvData.slice(0, 3));

        // Merge datasets based on timestamp
        mergedData = mergeAsOf(gpxData, csvData, 5);

        if (mergedData.length === 0) {
            throw new Error("Could not align GPX and CSV timestamps.");
        }

        // Initialize UI components
        initMap(mergedData);
        initChart(mergedData);
        setupAudio();
        
        // Expose replay section
        replaySection.classList.remove('hidden');
        timeSlider.max = mergedData.length - 1;
        
        processBtn.innerText = "Process & Merge Data";
    } catch (error) {
        console.error(error);
        alert(`Error processing data: ${error.message}`);
        processBtn.innerText = "Process & Merge Data";
    }
});

/**
 * Utility function to read a File object as text.
 * @param {File} file - The uploaded file object.
 * @returns {Promise<string>} Resolves with the text content of the file.
 */
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/**
 * Parses raw GPX XML string into an array of coordinate objects.
 * Calculates 'seconds_elapsed' relative to the first track point.
 * @param {string} gpxText - Raw XML string.
 * @returns {Array<Object>} Array of objects: { lat, lon, time, seconds_elapsed }.
 */
function parseGPX(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    const trkpts = xmlDoc.getElementsByTagName('trkpt');
    
    const parsed = [];
    let startTime = null;

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const timeNode = pt.getElementsByTagName('time')[0];
        
        if (timeNode) {
            const timeDate = new Date(timeNode.textContent);
            if (i === 0) startTime = timeDate.getTime();
            
            const seconds_elapsed = Math.round((timeDate.getTime() - startTime) / 1000);
            parsed.push({ lat, lon, seconds_elapsed });
        }
    }
    return parsed;
}

/**
 * Parses raw CSV/TSV text into an array of JSON objects using PapaParse.
 * Built with heavy regex normalization to conquer CoxOrb file formatting.
 */
function parseCSV(csvText) {
    console.log("--- CSV PARSER DEBUG ---");
    // Print the raw string so we can see if it's full of weird characters
    console.log("Raw First 100 chars:", csvText.substring(0, 100).replace(/\n/g, '\\n').replace(/\t/g, '[TAB]'));

    const lines = csvText.split(/\r\n|\n|\r/);
    let headerLineIdx = -1;

    // 1. Find Header Line
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        // Strip absolutely everything except letters. "Elapsed Time" becomes "ELAPSEDTIME"
        const rawLine = lines[i].toUpperCase().replace(/[^A-Z]/g, ''); 
        if (rawLine.includes("ELAPSEDTIME") || rawLine.includes("DISTANCE")) {
            headerLineIdx = i;
            break;
        }
    }

    if (headerLineIdx === -1) {
        console.error("Could not detect header row! Check if the file is corrupted.");
        return [];
    }

    // 2. Detect Delimiter (Comma vs Tab)
    const headerString = lines[headerLineIdx];
    let delim = ',';
    if (headerString.includes('\t')) delim = '\t';
    else if (headerString.includes(';')) delim = ';';
    
    console.log(`Header found at line ${headerLineIdx}. Using delimiter: ${delim === '\t' ? 'TAB' : 'COMMA'}`);

    // 3. Parse with PapaParse
    const targetCSV = lines.slice(headerLineIdx).join('\n');
    const results = Papa.parse(targetCSV, {
        header: true,
        skipEmptyLines: true,
        delimiter: delim
    });

    console.log(`PapaParse extracted ${results.data.length} rows.`);
    if (results.data.length > 0) {
        console.log("Raw headers array detected:", Object.keys(results.data[0]));
    }

    // 4. Extract Data Safely
    const parsed = [];
    results.data.forEach(row => {
        const keys = Object.keys(row);
        
        // Normalize keys to find the ones we want, ignoring all spacing/symbols
        const timeKey = keys.find(k => k.replace(/[^a-zA-Z]/g, '').toUpperCase().includes("ELAPSEDTIME"));
        const rateKey = keys.find(k => k.replace(/[^a-zA-Z]/g, '').toUpperCase().includes("RATE"));
        const speedKey = keys.find(k => k.toUpperCase().includes("M/S"));
        const distKey = keys.find(k => k.replace(/[^a-zA-Z]/g, '').toUpperCase().includes("DISTANCE"));

        // If the row has an elapsed time, process it
        if (timeKey && row[timeKey] && row[timeKey].trim() !== "") {
            const cleanRow = {};
            cleanRow.seconds_elapsed = parseTimeStr(row[timeKey]);
            
            cleanRow['Elapsed Time'] = row[timeKey].trim();
            cleanRow['Rate'] = rateKey ? parseFloat(row[rateKey]) : null;
            cleanRow['Distance/Stroke'] = distKey ? parseFloat(row[distKey]) : null;
            
            const speed = speedKey ? parseFloat(row[speedKey]) : 0;
            cleanRow['Speed (m/s)'] = speed;
            cleanRow.split_seconds = (speed > 0) ? (500 / speed) : null;
            
            parsed.push(cleanRow);
        }
    });

    console.log(`Successfully formatted ${parsed.length} rows for the app.`);
    console.log("------------------------");
    return parsed;
}

/**
 * Converts a MM:SS or HH:MM:SS time string into total integers seconds.
 * @param {string} timeStr - The time string from the CSV.
 * @returns {number} Total seconds elapsed.
 */
function parseTimeStr(timeStr) {
    if (!timeStr) return 0;
    
    // Convert to string and clean whitespace
    const str = String(timeStr).trim();
    const parts = str.split(':');
    let totalSeconds = 0;
    
    if (parts.length === 3) {
        totalSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        totalSeconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    } else if (parts.length === 1) {
        // Handles cases where the time is just raw seconds (e.g., "45.5")
        totalSeconds = parseFloat(parts[0]);
    }
    
    // Fallback to 0 if parsing fails
    return Math.round(totalSeconds) || 0;
}

/**
 * Replicates Python's pd.merge_asof(direction='nearest').
 * Matches each GPX coordinate to the nearest available CSV stroke data based on time.
 * @param {Array<Object>} gpx - Array of GPX coordinate objects.
 * @param {Array<Object>} csv - Array of CSV performance objects.
 * @param {number} tolerance - Maximum allowable time difference in seconds.
 * @returns {Array<Object>} Combined array with map and performance data.
 */
function mergeAsOf(gpx, csv, tolerance) {
    const merged = [];
    
    // Iterate through high-frequency GPX data to maintain smooth map rendering
    gpx.forEach(pt => {
        const targetTime = pt.seconds_elapsed;
        let bestMatch = null;
        let minDiff = Infinity;

        // Find nearest CSV point within tolerance limits
        for (let i = 0; i < csv.length; i++) {
            const diff = Math.abs(csv[i].seconds_elapsed - targetTime);
            if (diff < minDiff && diff <= tolerance) {
                minDiff = diff;
                bestMatch = csv[i];
            }
        }

        if (bestMatch) {
            merged.push({ ...pt, ...bestMatch });
        }
    });

    return merged;
}

/**
 * Initializes the Leaflet map and draws the polyline path.
 * @param {Array<Object>} data - Merged dataset containing latitudes and longitudes.
 */
function initMap(data) {
    if (mapInstance) mapInstance.remove();

    const startLoc = [data[0].lat, data[0].lon];
    mapInstance = L.map('map').setView(startLoc, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapInstance);

    const latlngs = data.map(pt => [pt.lat, pt.lon]);
    L.polyline(latlngs, { color: 'blue', weight: 3 }).addTo(mapInstance);

    // Initialise the draggable boat marker
    boatMarker = L.circleMarker(startLoc, { color: 'red', radius: 6, fillOpacity: 1 }).addTo(mapInstance);
    mapInstance.fitBounds(L.polyline(latlngs).getBounds());
}

/**
 * Initializes Chart.js line graph for performance metrics.
 * @param {Array<Object>} data - Merged dataset.
 */
function initChart(data) {
    if (chartInstance) chartInstance.destroy();

    const ctx = document.getElementById('metricsChart').getContext('2d');
    const labels = data.map(d => d['Elapsed Time'] || d.seconds_elapsed);
    const rateData = data.map(d => parseFloat(d['Rate']) || null);
    const splitData = data.map(d => d.split_seconds || null);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Stroke Rate',
                    data: rateData,
                    borderColor: 'blue',
                    yAxisID: 'y'
                },
                {
                    label: 'Split (s/500m)',
                    data: splitData,
                    borderColor: 'green',
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Disabling animation ensures real-time slider sync is seamless
            scales: {
                y: { type: 'linear', display: true, position: 'left' },
                y1: { type: 'linear', display: true, position: 'right', reverse: true } // Inverted scale for splits
            }
        }
    });
}

/**
 * Loads user audio and links media playback to the data slider.
 */
function setupAudio() {
    const file = audioUpload.files[0];
    if (file) {
        audioContainer.classList.remove('hidden');
        const url = URL.createObjectURL(file);
        audioPlayer.src = url;

        // Sync slider to audio playback
        audioPlayer.addEventListener('timeupdate', () => {
            const currentTime = Math.round(audioPlayer.currentTime);
            // Locate corresponding index in merged data
            const index = mergedData.findIndex(d => d.seconds_elapsed >= currentTime);
            if (index !== -1) {
                timeSlider.value = index;
                updateUI(index);
            }
        });
    }
}

/**
 * Master UI updater triggered by user interactions (slider drag or audio playback).
 * @param {number} index - The current index of the mergedData array.
 */
function updateUI(index) {
    const pt = mergedData[index];
    if (!pt) return;

    // Update Map Marker
    boatMarker.setLatLng([pt.lat, pt.lon]);

    // Update Dashboard Values
    document.getElementById('val-time').innerText = pt['Elapsed Time'] || pt.seconds_elapsed;
    document.getElementById('val-rate').innerText = pt['Rate'] || "--";
    document.getElementById('val-dist').innerText = pt['Distance/Stroke'] || "--";

    // Format split for dashboard
    if (pt.split_seconds) {
        const m = Math.floor(pt.split_seconds / 60);
        const s = (pt.split_seconds % 60).toFixed(1).padStart(4, '0');
        document.getElementById('val-split').innerText = `${m}:${s}`;
    } else {
        document.getElementById('val-split').innerText = "--";
    }

    // Optional: Render a vertical line on Chart.js to track position
    // (Implementation omitted for brevity, but relies on Chart.js plugin API)
}

/**
 * Event Listener for manual slider dragging.
 */
timeSlider.addEventListener('input', (e) => {
    updateUI(e.target.value);
});
