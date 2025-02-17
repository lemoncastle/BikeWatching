// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibWVsb25jYXN0bGUiLCJhIjoiY203N3lhdmN4MTM1dzJrcGpjZjVkNGFhMiJ9.cJqT1cmLKtS5Lq0za-akHg';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18 // Maximum allowed zoom
});

const blStyle = {
    'line-color': 'green',
    'line-width': 3,
    'line-opacity': 0.5
};

const svg = d3.select('#map').select('svg');
let stations = [];
let circles;

let filteredTrips = [];
let filteredArrivals = new Map();
let filteredDepartures = new Map();
let filteredStations = [];
let timeFilter = -1;
const timeSlider = document.getElementById('time-slider');
const anyTimeLabel = document.getElementById('any-time');
const selectedTime = document.getElementById('selected-time');
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Function to project station coordinates onto the map  
function getCoords(station) {
    const point = map.project([+station.lon, +station.lat]);
    return { cx: point.x, cy: point.y };
}

// Function to update circle positions when the map moves/zooms
function updatePositions() {
    circles
        .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
}
function minutesSinceMidnight(date) { return date.getHours() * 60 + date.getMinutes(); }

map.on('load', () => { 
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: blStyle
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: blStyle 
    });

    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    d3.json(jsonurl).then(jsonData => {
        stations = jsonData.data.stations;
        
        circles = svg.selectAll('circle')
            .data(stations)
            .enter()
            .append('circle')
            .attr('r', 5)               // Radius of the circle
            .attr('fill', 'steelblue')  // Circle fill color
            .attr('stroke', 'white')    // Circle border color
            .attr('stroke-width', 1)    // Circle border thickness
            .attr('opacity', 0.7)      // Circle opacity
        
        // Reposition markers on map interactions
        map.on('move', updatePositions);     // Update during map movement
        map.on('zoom', updatePositions);     // Update during zooming
        map.on('resize', updatePositions);   // Update on window resize
        map.on('moveend', updatePositions);  // Final adjustment after movement ends

        // Initial position update when map loads
        updatePositions();
    }).catch(error => {
        console.error('Error loading JSON:', error);  // Handle errors if JSON loading fails
    });

    d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv').then(trips => {
        let arrivals = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.end_station_id
        );
        
        departures = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.start_station_id,
        );

        stations = stations.map((station) => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.departures + station.arrivals;
            return station;
        });
        let radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, d => (d.totalTraffic))])
            .range([0, 25]);
        
        circles.attr('r', d => radiusScale(d.totalTraffic))
        .each(function(d) { // Add a browser tooltip to each circle
            d3.select(this)
                .append('title')
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });
        for (let trip of trips) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
        }
        
        function filterTripsbyTime() {
            filteredTrips = timeFilter === -1
            ? trips
            : trips.filter((trip) => {
                const startedMinutes = minutesSinceMidnight(trip.started_at);
                const endedMinutes = minutesSinceMidnight(trip.ended_at);
                return (
                    Math.abs(startedMinutes - timeFilter) <= 60 ||
                    Math.abs(endedMinutes - timeFilter) <= 60
                );
            });
        
            filteredArrivals = d3.rollup(
                filteredTrips,
                (v) => v.length,
                (d) => d.end_station_id
            );
            filteredDepartures = d3.rollup(
                filteredTrips,
                (v) => v.length,
                (d) => d.start_station_id,
            );
            
            filteredStations = stations.map((station) => {
                station = { ...station };
                let id = station.short_name;
                station.arrivals = filteredArrivals.get(id) ?? 0;
                station.departures = filteredDepartures.get(id) ?? 0;
                station.totalTraffic = station.departures + station.arrivals;
                return station;
            });

            let maxTraffic = d3.max(filteredStations, d => d.totalTraffic) || 1; // Prevent zero max
            
            radiusScale.range(timeFilter === -1 ? [0, 25] : [0, 15]).domain([0, maxTraffic]);
        
            circles.data(filteredStations)
                .transition()
                .duration(500)
                .attr('r', d => radiusScale(d.totalTraffic))
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy)
                .select('title')
                .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        }
        
        function formatTime(minutes) {
            const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
            return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
        }
        
        function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value);  // Get slider value
          
            if (timeFilter === -1) {
              selectedTime.textContent = '';  // Clear time display
              anyTimeLabel.style.display = 'block';  // Show "(any time)"
            } else {
              selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
              anyTimeLabel.style.display = 'none';  // Hide "(any time)"
            }
          
            filterTripsbyTime();
    
        }
        
        timeSlider.addEventListener('input', updateTimeDisplay);  // Update display on slider input
        updateTimeDisplay();

    }).catch(error => {
        console.error('Error loading CSV:', error);  // Handle errors if CSV loading fails
    });
});