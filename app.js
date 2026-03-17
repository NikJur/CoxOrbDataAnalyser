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
let compareMapInstance = null;

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

        // Expose replay section
        replaySection.classList.remove('hidden'); // Expose the replay container
        document.getElementById('compare-section').classList.remove('hidden'); // Expose the comparison tool
        
        // Initialize UI components
        initMap(mergedData);
        initChart(mergedData);
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

    const latlngs = data.map(pt => [pt.lat, pt.lon]);
    L.polyline(latlngs, { color: 'blue', weight: 3 }).addTo(mapInstance);

    // Initialise the draggable boat marker
    boatMarker = L.circleMarker(startLoc, { color: 'red', radius: 6, fillOpacity: 1 }).addTo(mapInstance);
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
                    callbacks: {
                        // Formats the tooltip text when you hover over the chart
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            
                            // If we are hovering over the split line, format the number
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

    // Update the global index and trigger an instant chart redraw
    currentSliderIndex = index;
    if (chartInstance) {
        chartInstance.update('none'); 
    }
}

/**
 * Event Listener for manual slider dragging.
 */
timeSlider.addEventListener('input', (e) => {
    updateUI(e.target.value);
});


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
        document.getElementById('compare-section').classList.remove('hidden');

        // Render visualisations
        initMap(mergedData);
        initChart(mergedData);

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
        
        // Configure the audio player with the demo recording
        audioContainer.classList.remove('hidden');
        audioPlayer.src = 'demo_data/example_recording.m4a';
        
        // Attach the synchronization event listener specifically for the demo audio
        audioPlayer.addEventListener('timeupdate', () => {
            const currentTime = Math.round(audioPlayer.currentTime);
            const index = mergedData.findIndex(d => d.seconds_elapsed >= currentTime);
            if (index !== -1) {
                timeSlider.value = index;
                updateUI(index);
            }
        });

        timeSlider.max = mergedData.length - 1;
        demoBtn.innerText = "Load Demo Data"; // Reset button text on success
    } catch (error) {
        console.error(error);
        alert(`Error loading demo data: ${error.message}`);
        demoBtn.innerText = "Load Demo Data";
    }
});

/**
 * Renders a secondary Leaflet map dedicated solely to route comparison.
 * Extracts the primary route coordinates from the global mergedData state 
 * and plots them alongside the newly uploaded comparison route.
 * Both paths are rendered as solid lines (Blue vs Orange) and the map bounds 
 * are calculated to ensure both entire routes are visible.
 * @param {Array<Object>} compareData - Parsed GPX coordinates from the secondary file.
 */
function renderCompareMap(compareData) {
    document.getElementById('compare-map-container').classList.remove('hidden');

    // Destroy previous instance if a new comparison is uploaded
    if (compareMapInstance) compareMapInstance.remove();

    // Ensure primary data exists to compare against
    if (!mergedData || mergedData.length === 0) return;

    // Extract coordinates
    const primaryLatlngs = mergedData.map(pt => [pt.lat, pt.lon]);
    const compareLatlngs = compareData.map(pt => [pt.lat, pt.lon]);

    const startLoc = primaryLatlngs[0];
    compareMapInstance = L.map('compare-map').setView(startLoc, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(compareMapInstance);

    // Draw both lines as solid, distinct colors
    const primaryLine = L.polyline(primaryLatlngs, { color: 'blue', weight: 3 }).addTo(compareMapInstance);
    const compareLine = L.polyline(compareLatlngs, { color: '#F08118', weight: 3 }).addTo(compareMapInstance);

    // Calculate the bounding box to encapsulate both routes
    const bounds = primaryLine.getBounds().extend(compareLine.getBounds());
    compareMapInstance.fitBounds(bounds);

    // Attach resize observer to ensure smooth scaling
    const container = document.getElementById('compare-map-container');
    const resizeObserver = new ResizeObserver(() => {
        if (compareMapInstance) compareMapInstance.invalidateSize();
    });
    resizeObserver.observe(container);
}

/**
 * Event Listener for the comparison GPX upload button.
 * Parses a secondary GPX file and plots it onto a new dedicated map canvas.
 */
document.getElementById('compare-btn').addEventListener('click', async () => {
    const compareFile = document.getElementById('gpx-compare-upload').files[0];
    const compareBtn = document.getElementById('compare-btn');

    if (!compareFile) {
        alert("Please upload a comparison GPX file.");
        return;
    }

    try {
        compareBtn.innerText = "Processing...";
        const gpxText = await readFileAsText(compareFile);
        const compareData = parseGPX(gpxText);

        renderCompareMap(compareData); // Pass data to the new map function

        compareBtn.innerText = "Compare Routes";
    } catch (error) {
        console.error(error);
        alert(`Error loading comparison data: ${error.message}`);
        compareBtn.innerText = "Compare Routes";
    }
});