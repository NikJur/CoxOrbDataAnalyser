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
let currentSliderIndex = 0; // Tracks the current stroke for the chart's vertical line

let primaryRouteLayer = null; // Holds the primary map route (solid or segmented)

let compareMapInstance = null;
let compareLayers = [null, null, null, null, null];
const compareColors = ['#25476D', '#F08118', '#000000', '#C0392B', '#8E44AD'];

// Virtual Timeline state variables for the looped demo audio
let isVirtualAudioLoop = false;
let virtualLoopCount = 0;
let lastPlaybackTime = 0;
let baseAudioDuration = 0;

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
document.getElementById('process-btn').addEventListener('click', async () => {
    const gpxFile = document.getElementById('gpx-upload').files[0];
    const csvFile = document.getElementById('csv-upload').files[0];

    if (!gpxFile) {
        alert("Please upload at least a GPX file to visualize the route.");
        return;
    }

    try {
        processBtn.innerText = "Processing...";
        
        // parse the GPX file
        const gpxText = await readFileAsText(gpxFile);
        gpxData = parseGPX(gpxText);

        const chartContainer = document.querySelector('.chart-container');
        const dashboard = document.getElementById('dashboard');
        const speedToggleContainer = document.getElementById('speed-toggle-container');

        // Did the user upload a CSV?
        if (csvFile) {
            const csvText = await readFileAsText(csvFile);
            csvData = parseCSV(csvText);

            // Merge datasets based on timestamp
            mergedData = mergeAsOf(gpxData, csvData, 5);

            if (mergedData.length === 0) {
                throw new Error("Could not align GPX and CSV timestamps.");
            }

            // Un-hide the metric elements and render the chart
            chartContainer.style.display = 'block';
            dashboard.style.display = 'flex';

            // Defensively expose the metric elements and the speed toggle
            if (chartContainer) chartContainer.style.display = 'block';
            if (dashboard) dashboard.style.display = 'flex';
            if (speedToggleContainer) {
                speedToggleContainer.classList.remove('hidden');
                speedToggleContainer.style.display = 'flex';
            }

            // Safely expose the metric elements and the speed toggle
            toggleAnalyticalUI(true);

            calculateSmartThresholds();

            initChart(mergedData);
        } else {
            // If no CSV is present, use the temporal GPX data
            mergedData = gpxData; 
            
            // Defensively conceal the empty elements and the unsupported speed toggle
            if (chartContainer) chartContainer.style.display = 'none';
            if (dashboard) dashboard.style.display = 'none';
            if (speedToggleContainer) speedToggleContainer.style.display = 'none';
            
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }

            // Safely conceal the empty elements and the unsupported speed toggle
            toggleAnalyticalUI(false);
            // Update the map without chart dependencies
            initMap(mergedData);

        }
        /**
         * Master Timeline Configuration
         * Exposes the slider and audio controls once the data arrays are populated.
         * Binds the maximum slider value to the length of the newly processed dataset,
         * allowing the user to scrub the map and chart even without an audio track.
         */
        const audioContainer = document.getElementById('audio-container');
        const timeSlider = document.getElementById('time-slider');
        
        if (mergedData.length > 0) {
            if (audioContainer) {
                audioContainer.classList.remove('hidden');
                audioContainer.style.display = 'flex';
            }
            
            if (timeSlider) {
                timeSlider.max = mergedData.length - 1;
                timeSlider.value = 0;
                
                // Resets the blue gradient track to zero for the new file
                if (typeof updateSliderFill === 'function') {
                    updateSliderFill(); 
                }
            }
        }

        // Expose replay section
        replaySection.classList.remove('hidden');
        
        // Initialize universal UI components
        initMap(mergedData);
        setupAudio();
        
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
.
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
 * Evaluates the velocity magnitude and assigns a corresponding hex color.
 * Maps velocities to a standard heatmap gradient (Red = Slow, Green = Fast).
 * Designed around typical rowing shell velocities in meters per second.
 * @param {number} speed - The recorded speed value in m/s.
 * @returns {string} The designated hex color string.
 */
function getSpeedColor(speed) {
    if (speed > 4.5) return '#27AE60'; // Fast (Green)
    if (speed > 3.5) return '#2ECC71'; // Above Average (Light Green)
    if (speed > 2.5) return '#F1C40F'; // Average (Yellow)
    if (speed > 1.5) return '#E67E22'; // Slow (Orange)
    return '#E74C3C';                  // Very Slow/Stationary (Red)
}

/**
 * Constructs the primary path on the Leaflet map.
 * Reads user-defined minimum and maximum speed thresholds to paint a dynamic gradient.
 * @param {boolean} useSpeedColors - Flag defining whether to use the heatmap gradient.
 */
function drawPrimaryRoute(useSpeedColors) {
    if (!mapInstance || mergedData.length === 0) return;

    if (primaryRouteLayer) {
        mapInstance.removeLayer(primaryRouteLayer);
    }

    primaryRouteLayer = L.featureGroup();
    const thresholdUI = document.getElementById('speed-thresholds');

    if (!useSpeedColors) {
        // Standard blue line mode
        if (thresholdUI) thresholdUI.classList.add('hidden');
        
        const latlngs = mergedData.map(pt => [pt.lat, pt.lon]);
        L.polyline(latlngs, { color: 'blue', weight: 3 }).addTo(primaryRouteLayer);
    } else {
        // Dynamic heatmap mode
        if (thresholdUI) thresholdUI.classList.remove('hidden');

        // Extract the boundaries from the HTML inputs
        const minSpeed = parseFloat(document.getElementById('min-speed-input').value) || 0;
        const maxSpeed = parseFloat(document.getElementById('max-speed-input').value) || 5;

        for (let i = 0; i < mergedData.length - 1; i++) {
            const pt1 = mergedData[i];
            const pt2 = mergedData[i + 1];
            
            const speed = pt1['Speed (m/s)'] || 0;
            const segmentColor = getDynamicSpeedColor(speed, minSpeed, maxSpeed);
            
            L.polyline([[pt1.lat, pt1.lon], [pt2.lat, pt2.lon]], { 
                color: segmentColor, 
                weight: 3 
            }).addTo(primaryRouteLayer);
        }
    }

    primaryRouteLayer.addTo(mapInstance);
    if (boatMarker) boatMarker.bringToFront();
}

/**
 * Initializes the Leaflet map, draws the polyline path, and adds the boat marker.
 * Implements a ResizeObserver to automatically redraw the map canvas when the user 
 * manually drags the bottom-right corner to change the container size.
 * @param {Array<Object>} data - Merged dataset containing latitudes and longitudes.
 */
function initMap(data) {
    // Destroy previous map instance if a new file is uploaded
    if (mapInstance) mapInstance.remove();

    const startLoc = [data[0].lat, data[0].lon];
    mapInstance = L.map('map').setView(startLoc, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapInstance);
    
    // Render the initial solid blue route using the new dynamic function
    drawPrimaryRoute(false);

    // Initialise the draggable boat marker
    boatMarker = L.circleMarker(startLoc, { color: 'red', radius: 6, fillOpacity: 1 }).addTo(mapInstance);
    
    // Ensure bounds are calculated using the full coordinate array
    const latlngs = data.map(pt => [pt.lat, pt.lon]);
    mapInstance.fitBounds(L.polyline(latlngs).getBounds());

    // Watch the #map-container for dimension changes triggered by the CSS resize handle
    const mapContainer = document.getElementById('map-container');
    const resizeObserver = new ResizeObserver(() => {
        if (mapInstance) {
            // Forces Leaflet to recalculate tile placements to fill the newly created space
            mapInstance.invalidateSize();
        }
    });
    
    // Start watching the container
    resizeObserver.observe(mapContainer);
}

/**
 * Initializes Chart.js line graph for performance metrics.
 * @param {Array<Object>} data - Merged dataset.
 */
function initChart(data) {
    // Destroy existing chart to prevent memory leaks during reloads
    if (chartInstance) chartInstance.destroy();

    const ctx = document.getElementById('metricsChart').getContext('2d');

    // Extract arrays once to feed into the chart
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
                    yAxisID: 'y',
                    normalized: true // Tells Chart.js data is sorted, skipping expensive parsing
                },
                {
                    label: 'Split',
                    data: splitData,
                    borderColor: 'green',
                    yAxisID: 'y1',
                    normalized: true // Speeds up rendering workload
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Disabling animation ensures real-time slider sync is seamless
            interaction: {
                mode: 'index',
                intersect: false, // Forces the tooltip to appear when hovering anywhere in the vertical column
            },
            elements: {
                point: {
                    radius: 0, // Disables drawing hundreds of individual dots
                    hitRadius: 10,
                    hoverRadius: 5
                },
                line: {
                    tension: 0 // Disables bezier curve calculations for instant, straight lines
                }
            },
            plugins: {
                tooltip: {
                    // CoxOrb style tooltip with custom colors and formatting to match the app's theme
                    backgroundColor: '#25476D',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#F08118',
                    borderWidth: 2,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        // Formats the tooltip text when you hover over the chart
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            
                            // If we are hovering over the split line, format the number into m:ss.t
                            if (context.dataset.yAxisID === 'y1') {
                                const val = context.parsed.y;
                                const m = Math.floor(val / 60);
                                const s = (val % 60).toFixed(1).padStart(4, '0');
                                label += `${m}:${s}`;
                            } else {
                                label += context.parsed.y;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: { display: true, text: 'Time / Distance' }
                },
                y: { 
                    type: 'linear', 
                    display: true, 
                    position: 'left',
                    title: { display: true, text: 'Stroke Rate' }
                },
                y1: { 
                    type: 'linear', 
                    display: true, 
                    position: 'right', 
                    reverse: true, // Inverted scale for splits (faster is higher on graph)
                    max: 300, // Culls any splits slower than 5:00.0 (300 seconds) - assume this is stationary: sorry!
                    title: { display: true, text: 'Split (m:ss.t)' },
                    ticks: {
                        // Formats the labels drawn on the actual right-hand y-axis to m:ss.t
                        callback: function(value) {
                            const m = Math.floor(value / 60);
                            const s = (value % 60).toFixed(1).padStart(4, '0');
                            return `${m}:${s}`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'verticalLinePlugin',
            afterDraw: (chart) => {
                // Ensure we have a valid index before attempting to draw
                if (typeof currentSliderIndex === 'undefined' || currentSliderIndex === null) return;
                
                // Get the physical pixel coordinates of the current data point
                const meta = chart.getDatasetMeta(0); // Uses dataset 0 (Rate) for the X-axis mapping
                const dataPoint = meta.data[currentSliderIndex];
                
                if (!dataPoint) return;

                const ctx = chart.ctx;
                ctx.save();
                
                // Draw a 2px red line from the top of the graph area to the bottom
                ctx.beginPath();
                ctx.moveTo(dataPoint.x, chart.chartArea.top);
                ctx.lineTo(dataPoint.x, chart.chartArea.bottom);
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'red';
                ctx.stroke();
                
                ctx.restore();
            }
        }]
    });
}

/**
 * Loads user-uploaded audio and resets any virtual loop states.
 * Prepares the audio container for standard linear playback.
 */
function setupAudio() {
    const file = audioUpload.files[0];
    if (file) {
        audioContainer.classList.remove('hidden');
        const url = URL.createObjectURL(file);
        audioPlayer.src = url;
        audioPlayer.loop = false; // Ensure manual uploads do not loop
        isVirtualAudioLoop = false; // Disable virtual timeline math
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

    // Update the global index and trigger an instant chart redraw
    currentSliderIndex = index;
    if (chartInstance) {
        chartInstance.update('none'); 
    }
}

/**
 * Event Listener for manual slider dragging.
 * Updates the UI and forces the audio player to seek to the correct corresponding timestamp.
 * Integrates mathematical wrapping to handle the looping virtual timeline for the demo.
 */
timeSlider.addEventListener('input', (e) => {
    const index = e.target.value;
    updateUI(index);
    
    // Ensure data exists and an audio file is loaded before attempting to calculate time
    if (mergedData.length > 0 && audioPlayer.src) {
        const targetSeconds = mergedData[index].seconds_elapsed || 0;
        
        if (isVirtualAudioLoop && baseAudioDuration > 0) {
            // Calculate exactly which loop we should be on, and the precise second within that loop
            virtualLoopCount = Math.floor(targetSeconds / baseAudioDuration);
            audioPlayer.currentTime = targetSeconds % baseAudioDuration;
            lastPlaybackTime = audioPlayer.currentTime; // Prevent false loop triggers
        } else {
            // Standard linear audio seeking for manual uploads
            audioPlayer.currentTime = targetSeconds;
        }
    }
});

/**
 * Safely manages the visibility of the secondary analytical interfaces.
 * Queries the DOM explicitly using precise class and ID selectors to prevent null reference errors.
 * @param {boolean} isVisible - Flag determining whether the elements should be rendered or concealed.
 */
function toggleAnalyticalUI(isVisible) {
    // Query the DOM using the explicit class (.) and ID (#) selectors matching index.html
    const chartView = document.querySelector('.chart-container');
    const dashboardView = document.querySelector('.dashboard');
    const speedToggleView = document.getElementById('speed-toggle-container');

    // Defensively apply styles only if the node successfully exists in the DOM
    if (chartView) {
        chartView.style.display = isVisible ? 'block' : 'none';
        if (isVisible) chartView.classList.remove('hidden');
    }
    
    if (dashboardView) {
        dashboardView.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) dashboardView.classList.remove('hidden');
    }
    
    if (speedToggleView) {
        speedToggleView.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) speedToggleView.classList.remove('hidden');
    }
}

/**
 * Dynamically calculates a hex/hsl colour on a Red-to-Green gradient based on min/max bounds.
 * Utilizes the HSL colour space where 0 = Red, 60 = Yellow, 120 = Green.
 * @param {number} speed - The current speed value to evaluate.
 * @param {number} minSpeed - The lower boundary (Red).
 * @param {number} maxSpeed - The upper boundary (Green).
 * @returns {string} A CSS-compatible HSL colour string.
 */
function getDynamicSpeedColor(speed, minSpeed, maxSpeed) {
    // Prevent mathematical errors if bounds are identical
    if (maxSpeed <= minSpeed) return 'hsl(120, 100%, 45%)';

    // Clamp the speed so outliers do not break the colour scale
    const clampedSpeed = Math.max(minSpeed, Math.min(speed, maxSpeed));

    // Calculate the percentage (0.0 to 1.0) between the bounds
    const percent = (clampedSpeed - minSpeed) / (maxSpeed - minSpeed);

    // Map the percentage to a hue angle (0 to 120 degrees)
    const hue = percent * 120;

    return `hsl(${hue}, 100%, 45%)`;
}

/**
 * Calculates the 5th and 95th percentiles of the dataset's speed array.
 * Automatically injects these values into the HTML threshold inputs to trim outliers.
 */
function calculateSmartThresholds() {
    // Extract valid speed values and sort them in ascending order
    const speeds = mergedData.map(pt => pt['Speed (m/s)']).filter(s => s != null && !isNaN(s));
    if (speeds.length === 0) return;

    speeds.sort((a, b) => a - b);

    // Target the 5% and 95% indices to cleanly drop stationary times and GPS spikes
    const p5Index = Math.floor(speeds.length * 0.05);
    const p95Index = Math.floor(speeds.length * 0.95);

    const minInput = document.getElementById('min-speed-input');
    const maxInput = document.getElementById('max-speed-input');

    if (minInput) minInput.value = speeds[p5Index].toFixed(1);
    if (maxInput) maxInput.value = speeds[p95Index].toFixed(1);
}

/**
 * Fetches pre-uploaded demo data from the repository and initializes the application.
 * Uses the native Fetch API to retrieve files directly from the demo_data directory.
 * @param {Event} e - The click event object to prevent default page jumping.
 */
document.getElementById('demo-btn').addEventListener('click', async (e) => {
    e.preventDefault(); 
    const demoBtn = document.getElementById('demo-btn');
    demoBtn.innerText = "Loading Demo...";

    try {
        // Retrieve raw file data from the server directories
        const gpxResponse = await fetch('demo_data/example.GPX');
        const csvResponse = await fetch('demo_data/example_GRAPH.CSV');

        if (!gpxResponse.ok || !csvResponse.ok) {
            throw new Error("Could not locate demo files on the server.");
        }

        const gpxText = await gpxResponse.text();
        const csvText = await csvResponse.text();

        // Parse extracted text into data arrays
        gpxData = parseGPX(gpxText);
        csvData = parseCSV(csvText);

        // Merge temporal datasets
        mergedData = mergeAsOf(gpxData, csvData, 5);

        if (mergedData.length === 0) {
            throw new Error("Could not align GPX and CSV timestamps.");
        }

        // Expose the replay container to allow Leaflet and Chart.js to calculate dimensions
        replaySection.classList.remove('hidden');

        calculateSmartThresholds();

        // Render visualisations
        initMap(mergedData);
        initChart(mergedData);

        // Safely expose all analytical UI elements including the speed toggle
        toggleAnalyticalUI(true);

        // Fetch and render the comparison GPX automatically for the demo
        try {
            const compareResponse = await fetch('demo_data/example_comparison.gpx');
            if (compareResponse.ok) {
                const compareText = await compareResponse.text();
                const compareData = parseGPX(compareText);
                
                renderCompareMap(compareData); // Renders the second map automatically
            }
        } catch (err) {
            console.warn("Could not load comparison demo data.", err);
        }
        
        // Configure the audio player with the looped demo recording
        audioContainer.classList.remove('hidden');
        audioPlayer.src = 'demo_data/example_recording.m4a';
        audioPlayer.loop = true; // Instructs the browser to seamlessly restart the audio
        
        // Reset virtual timeline trackers
        isVirtualAudioLoop = true;
        virtualLoopCount = 0;
        lastPlaybackTime = 0;
        
        // Capture the exact duration of the track once the browser loads the file metadata
        audioPlayer.onloadedmetadata = () => {
            baseAudioDuration = audioPlayer.duration;
        };
        
        timeSlider.max = mergedData.length - 1;

        // --- MULTI-ROUTE COMPARISON DEMO SETUP ---
        document.getElementById('compare-map-container').classList.remove('hidden');

        // Initialize the secondary comparison map if it does not exist
        if (!compareMapInstance) {
            const startLoc = [gpxData[0].lat, gpxData[0].lon];
            compareMapInstance = L.map('compare-map').setView(startLoc, 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(compareMapInstance);

            const container = document.getElementById('compare-map-container');
            const resizeObserver = new ResizeObserver(() => {
                if (compareMapInstance) compareMapInstance.invalidateSize();
            });
            resizeObserver.observe(container);
        }

        try {
            // Clear any previously existing layers from manual uploads
            for(let i = 0; i < 5; i++) {
                if (compareLayers[i]) {
                    compareMapInstance.removeLayer(compareLayers[i]);
                    compareLayers[i] = null;
                }
                // Reset toggles to unchecked to start fresh
                document.getElementById(`toggle-compare-${i+1}`).checked = false;
            }

            let bounds = L.latLngBounds([]);

            // Slot 1: The Primary Demo Route (Blue)
            const latlngs1 = gpxData.map(pt => [pt.lat, pt.lon]);
            const poly1 = L.polyline(latlngs1, { color: compareColors[0], weight: 3 });
            compareLayers[0] = poly1;
            document.getElementById('toggle-compare-1').checked = true; // Visually switch toggle ON
            poly1.addTo(compareMapInstance);
            bounds.extend(poly1.getBounds());

            // Slot 2: Fetch and render the secondary Comparison Demo Route (Orange)
            const compareResponse = await fetch('demo_data/example_comparison.gpx');
            if (compareResponse.ok) {
                const compareText = await compareResponse.text();
                const compareData = parseGPX(compareText);
                const latlngs2 = compareData.map(pt => [pt.lat, pt.lon]);
                
                const poly2 = L.polyline(latlngs2, { color: compareColors[1], weight: 3 });
                compareLayers[1] = poly2;
                document.getElementById('toggle-compare-2').checked = true; // Visually switch toggle ON
                poly2.addTo(compareMapInstance);
                bounds.extend(poly2.getBounds());
            }

            // Adjust map view to encompass both routes
            if (bounds.isValid()) {
                compareMapInstance.fitBounds(bounds);
            }

        } catch (err) {
            console.warn("Could not load secondary comparison demo data.", err);
        }


        demoBtn.innerText = "Load Demo Data"; // Reset button text on success
    } catch (error) {
        console.error(error);
        alert(`Error loading demo data: ${error.message}`);
        demoBtn.innerText = "Load Demo Data";
    }
});

/**
 * Event Listener for the "Render Comparison Map" button.
 * Loops through all 5 file inputs, parses any uploaded GPX files, 
 * creates colored polylines, and manages map boundaries.
 */
document.getElementById('compare-btn').addEventListener('click', async () => {
    const compareBtn = document.getElementById('compare-btn');
    compareBtn.innerText = "Processing...";

    document.getElementById('compare-map-container').classList.remove('hidden');

    // Initialize the comparison map if it does not exist yet
    if (!compareMapInstance) {
        compareMapInstance = L.map('compare-map').setView([51.474, -0.271], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(compareMapInstance);

        const container = document.getElementById('compare-map-container');
        const resizeObserver = new ResizeObserver(() => {
            if (compareMapInstance) compareMapInstance.invalidateSize();
        });
        resizeObserver.observe(container);
    }

    let bounds = L.latLngBounds([]);

    // Loop through all 5 input slots
    for (let i = 1; i <= 5; i++) {
        const fileInput = document.getElementById(`gpx-compare-${i}`);
        const isChecked = document.getElementById(`toggle-compare-${i}`).checked;

        if (fileInput.files.length > 0) {
            try {
                // Clear existing layer from this slot if overwriting
                if (compareLayers[i-1]) {
                    compareMapInstance.removeLayer(compareLayers[i-1]);
                }

                // Read and parse the local file
                const gpxText = await readFileAsText(fileInput.files[0]);
                const parsedData = parseGPX(gpxText);
                const latlngs = parsedData.map(pt => [pt.lat, pt.lon]);

                // Create the polyline using the designated row color
                const polyline = L.polyline(latlngs, { color: compareColors[i-1], weight: 3 });
                compareLayers[i-1] = polyline;

                bounds.extend(polyline.getBounds());

                // Immediately draw it if the toggle is currently switched "on"
                if (isChecked) {
                    polyline.addTo(compareMapInstance);
                }
            } catch (err) {
                console.error(`Error parsing Route ${i}:`, err);
            }
        }
    }

    // Zoom the map out just enough to see all drawn lines
    if (bounds.isValid()) {
        compareMapInstance.fitBounds(bounds);
    }

    compareBtn.innerText = "Render Comparison Map";
});

/**
 * Attaches event listeners to all 5 toggle switches.
 * Instantly adds or removes the corresponding line from the map when clicked.
 */
for (let i = 1; i <= 5; i++) {
    document.getElementById(`toggle-compare-${i}`).addEventListener('change', (e) => {
        const layer = compareLayers[i-1];
        if (layer && compareMapInstance) {
            if (e.target.checked) {
                layer.addTo(compareMapInstance);
            } else {
                compareMapInstance.removeLayer(layer);
            }
        }
    });
}

/**
 * Event Listener for the Primary "Clear" button.
 * Resets global arrays, destroys the chart, pauses audio, clears file inputs.
 */
document.getElementById('clear-primary-btn').addEventListener('click', () => {
    // Clear global data arrays
    gpxData = [];
    csvData = [];
    mergedData = [];
    currentSliderIndex = 0;

    // Reset the virtual audio loop state to prevent math errors on future uploads
    isVirtualAudioLoop = false;
    virtualLoopCount = 0;
    lastPlaybackTime = 0;

    // Reset the physical file input fields
    document.getElementById('gpx-upload').value = '';
    document.getElementById('csv-upload').value = '';
    document.getElementById('audio-upload').value = '';


    // Safely destroy the Chart.js instance to free up memory
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    // Safely destroy the Leaflet map instance to clear the route and boat marker
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        boatMarker = null;
    }

    // Stop audio playback and reset the source
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.loop = false; // Ensure loop is turned off
    document.getElementById('play-pause-btn').innerText = "▶"; // Resets icon

    // Reset Dashboard text metrics back to default state
    document.getElementById('val-time').innerText = '--';
    document.getElementById('val-rate').innerText = '--';
    document.getElementById('val-dist').innerText = '--';
    document.getElementById('val-split').innerText = '--';
    
    // Reset the slider
    timeSlider.value = 0;
    timeSlider.max = 0;

    // Reset the speed colour toggle to default
    const speedToggleInput = document.getElementById('toggle-speed-color');
    if (speedToggleInput) speedToggleInput.checked = false;

    // Hide the visualization containers again
    replaySection.classList.add('hidden');
    audioContainer.classList.add('hidden');
});

/**
 * Event Listener for the Comparison "Clear" button.
 * Removes all polyline layers from the comparison map, clears the 5 file inputs, 
 * resets the toggles.
 */
document.getElementById('clear-compare-btn').addEventListener('click', () => {
    // Loop through all 5 slots to remove layers and reset UI
    for (let i = 0; i < 5; i++) {
        // Remove the colored line from the map if it exists
        if (compareLayers[i] && compareMapInstance) {
            compareMapInstance.removeLayer(compareLayers[i]);
            compareLayers[i] = null;
        }
        
        // Clear the file input
        document.getElementById(`gpx-compare-${i+1}`).value = '';
        
        // Reset the toggle switch back to its default checked state
        document.getElementById(`toggle-compare-${i+1}`).checked = true;
    }
    // Hide the comparison map container again
    document.getElementById('compare-map-container').classList.add('hidden');
});

/**
 * Master Event Listener for Audio Playback synchronisation.
 * Fires continuously as the audio plays, matching the audio clock to the data array.
 * Translates the short looped demo audio into a continuous virtual timeline.
 */
audioPlayer.addEventListener('timeupdate', () => {
    let currentTargetTime = 0;
    
    if (isVirtualAudioLoop && baseAudioDuration > 0) {
        const currentPlaybackTime = audioPlayer.currentTime;
        
        // Detect if the native player has looped back to the beginning naturally
        if (currentPlaybackTime < lastPlaybackTime - 1) {
            virtualLoopCount++;
        }
        lastPlaybackTime = currentPlaybackTime;
        
        // Calculate the total continuous time across all elapsed loops
        currentTargetTime = Math.round((virtualLoopCount * baseAudioDuration) + currentPlaybackTime);
    } else {
        // Standard linear audio playback tracking
        currentTargetTime = Math.round(audioPlayer.currentTime);
    }
    
    // Find the corresponding data row based on the calculated time and update the dashboard
    const index = mergedData.findIndex(d => d.seconds_elapsed >= currentTargetTime);
    if (index !== -1) {
        timeSlider.value = index;
        updateUI(index);
    }
});

/**
 * Event Listener for the custom Play/Pause button.
 * Toggles the playback state of the hidden native audio element.
 * Updates the button's internal text icon to reflect the current state.
 */
const playPauseBtn = document.getElementById('play-pause-btn');

playPauseBtn.addEventListener('click', () => {
    // Prevent interaction if no audio source is loaded
    if (!audioPlayer.src) return;

    if (audioPlayer.paused) {
        audioPlayer.play();
        playPauseBtn.innerText = "⏸";
    } else {
        audioPlayer.pause();
        playPauseBtn.innerText = "▶";
    }
});

/**
 * Skips the audio and timeline forward or backward by a specified number of seconds.
 * Incorporates safety checks to prevent skipping beyond the start or end of the data.
 * Computes the virtual looping timeline maths if the demo mode is active.
 * @param {number} offset - The integer number of seconds to skip (positive or negative).
 */
function skipTime(offset) {
    if (!audioPlayer.src || mergedData.length === 0) return;

    let currentAbsoluteTime = 0;

    // Calculate the current absolute timeline position
    if (isVirtualAudioLoop && baseAudioDuration > 0) {
        currentAbsoluteTime = (virtualLoopCount * baseAudioDuration) + audioPlayer.currentTime;
    } else {
        currentAbsoluteTime = audioPlayer.currentTime;
    }

    // Determine the target time and restrict it to the bounds of the recorded data
    let targetTime = currentAbsoluteTime + offset;
    const maxTime = mergedData[mergedData.length - 1].seconds_elapsed;
    
    if (targetTime < 0) targetTime = 0;
    if (targetTime > maxTime) targetTime = maxTime;

    // Apply the new time back to the audio player correctly
    if (isVirtualAudioLoop && baseAudioDuration > 0) {
        virtualLoopCount = Math.floor(targetTime / baseAudioDuration);
        audioPlayer.currentTime = targetTime % baseAudioDuration;
        lastPlaybackTime = audioPlayer.currentTime; // Reset tracker to prevent false loop triggers
    } else {
        audioPlayer.currentTime = targetTime;
    }

    // Force an immediate UI update so the map and chart sync instantly while paused
    const index = mergedData.findIndex(d => d.seconds_elapsed >= targetTime);
    if (index !== -1) {
        timeSlider.value = index;
        updateUI(index);
    }
}

// Attach click listeners to the HTML UI skip buttons
document.getElementById('skip-back-btn').addEventListener('click', () => skipTime(-10));
document.getElementById('skip-fwd-btn').addEventListener('click', () => skipTime(10));

/**
 * Global Event Listener for Keyboard Shortcuts.
 * Enables timeline toggling via Spacebar, and 10-second jumps via Left/Right Arrows.
 * Intercepts default browser behaviors (scrolling) to keep the dashboard stable.
 * @param {KeyboardEvent} e - The keydown event object.
 */
document.addEventListener('keydown', (e) => {
    // Prevent the browser from scrolling horizontally or vertically when pressing specific hotkeys
    if (['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
    }

    // Process the shortcut only if an audio file is actively loaded
    if (audioPlayer && audioPlayer.src) {
        if (e.code === 'Space') {
            const playPauseBtn = document.getElementById('play-pause-btn');
            if (audioPlayer.paused) {
                audioPlayer.play();
                if (playPauseBtn) playPauseBtn.innerText = "⏸";
            } else {
                audioPlayer.pause();
                if (playPauseBtn) playPauseBtn.innerText = "▶";
            }
        } else if (e.code === 'ArrowLeft') {
            skipTime(-10);
        } else if (e.code === 'ArrowRight') {
            skipTime(10);
        }
    }
});

/**
 * Event Listener for the "Color Route by Speed" toggle.
 * Triggers a complete redraw of the primary Leaflet map path.
 */
const speedToggle = document.getElementById('toggle-speed-color');
if (speedToggle) {
    speedToggle.addEventListener('change', (e) => {
        drawPrimaryRoute(e.target.checked);
    });
}

/**
 * Event Listeners for the dynamic speed threshold inputs.
 * Forces the map to instantaneously redraw the gradient if the user alters the numbers.
 */
document.getElementById('min-speed-input').addEventListener('input', () => {
    const toggle = document.getElementById('toggle-speed-color');
    if (toggle && toggle.checked) drawPrimaryRoute(true);
});

document.getElementById('max-speed-input').addEventListener('input', () => {
    const toggle = document.getElementById('toggle-speed-color');
    if (toggle && toggle.checked) drawPrimaryRoute(true);
});

/**
 * Event Listener for the "Defaults" threshold button for speed-colouring reset.
 * Executes the smart threshold calculation to extract the 5th and 95th percentiles.
 * Forces an immediate visual redraw of the Leaflet map to reflect the statistical baseline.
 */
const defaultThresholdsBtn = document.getElementById('default-thresholds-btn');

if (defaultThresholdsBtn) {
    defaultThresholdsBtn.addEventListener('click', () => {
        // Recalculate and inject the optimum statistical bounds into the inputs
        calculateSmartThresholds();
        
        // Verify if the gradient toggle is currently active
        const toggle = document.getElementById('toggle-speed-color');
        if (toggle && toggle.checked) {
            // Command the map renderer to update using the new input values
            drawPrimaryRoute(true);
        }
    });
}

/**
 * Event Listener for the PDF Export button.
 * Triggers the browser's native print engine, relying on @media print CSS 
 * to strip the UI and format the canvas elements correctly.
 */
const printReportBtn = document.getElementById('print-report-btn');
if (printReportBtn) {
    printReportBtn.addEventListener('click', () => {
        // Standard browsers automatically prompt the "Save as PDF" dialog
        window.print();
    });
}

/**
 * Browser Print Event Interceptors
 * Resolves Leaflet rendering failures during PDF export.
 * Forces the map engine to recalculate its physical container dimensions and 
 * to frame the GPS data right before the browser captures the layout.
 */

let prePrintCenter = null;
let prePrintZoom = null;

window.addEventListener('beforeprint', () => {
    if (typeof mapInstance !== 'undefined' && mapInstance !== null) {

        // Captured the exact view the user was actively analysing
        prePrintCenter = mapInstance.getCenter();
        prePrintZoom = mapInstance.getZoom();

        // Command Leaflet to update its internal size cache to match the CSS @media print rules
        mapInstance.invalidateSize();
        
        // Snapp the camera back to the user's focal point without animation delays
        mapInstance.setView(prePrintCenter, prePrintZoom, { animate: false });
    }
});

window.addEventListener('afterprint', () => {
    if (typeof mapInstance !== 'undefined' && mapInstance !== null) {
        // Restore the standard web layout dimensions once the print dialog closes
        mapInstance.invalidateSize();

        // Restore same view so the workflow remains intact
        if (prePrintCenter && prePrintZoom) {
            mapInstance.setView(prePrintCenter, prePrintZoom, { animate: false });
        }
    }
});