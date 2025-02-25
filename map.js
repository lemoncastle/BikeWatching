// Set your **public** Mapbox access token here
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

// Bike lane styling
const blStyle = {
    'line-color': 'green',
    'line-width': 3,
    'line-opacity': 0.5
};

const svg = d3.select('#map').select('svg');
let stations = [];
let circles;

let filteredArrivals = new Map();
let filteredDepartures = new Map();
let filteredStations = [];
let timeFilter = -1;

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', () => { 
    map.addSource('boston_route', {
        type: 'geojson',
        data: './assets/Existing_Bike_Network_2022.geojson'
        // data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: blStyle
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: './assets/RECREATION_BikeFacilities.geojson'
        // data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: blStyle 
    });

    // const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonurl = './assets/bluebikes-stations.json';
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
            .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
        ;
        
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

    // const csvurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
    const csvurl = './assets/bluebikes-traffic-2024-03.csv';
    d3.csv(csvurl).then(trips => {
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
        
        for (const trip of trips) { // Group trips by minute of the day, for slider optimization
            const startedMinutes = minutesSinceMidnight(new Date(trip.started_at));
            const endedMinutes = minutesSinceMidnight(new Date(trip.ended_at));
        
            departuresByMinute[startedMinutes].push(trip);
            arrivalsByMinute[endedMinutes].push(trip);
        }

        function filterTripsbyTime() {
            let filteredArrivals1 = filterByMinute(arrivalsByMinute, timeFilter);
            let filteredDepartures1 = filterByMinute(departuresByMinute, timeFilter);
            if(timeFilter === -1) {
                filteredArrivals1 = arrivalsByMinute.flat();
                filteredDepartures1 = departuresByMinute.flat();
            }
            
            filteredArrivals = d3.rollup( // Roll up the filtered trips by station
                filteredArrivals1,
                (v) => v.length,
                (d) => d.end_station_id
            );
            filteredDepartures = d3.rollup( // Roll up the filtered trips by station
                filteredDepartures1,
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
            
            radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]); // Adjust radius scale based on time filter
        
            circles.data(filteredStations) // Update circles with filtered data
                .attr('r', d => radiusScale(d.totalTraffic))
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy)
                .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
                .select('title')
                .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`)
            ;
        }
        
        function formatTime(minutes) {
            const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
            return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
        }
        
        function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value);  // Get slider value
          
            if (timeFilter === -1) {
              selectedTime.innerHTML = '<em style="color: grey;">(any time)</em>';  // anytime
            } else {
              selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
            }
          
            filterTripsbyTime();
        }
        
        timeSlider.addEventListener('input', updateTimeDisplay);  // Update display on slider input
        updateTimeDisplay();

    }).catch(error => {
        console.error('Error loading CSV:', error);  // Handle errors if CSV loading fails
    });
});


// projects station coordinates onto the map  
function getCoords(station) {
    const point = map.project([+station.lon, +station.lat]);
    return { cx: point.x, cy: point.y };
}

// updates circle positions when the map moves/zooms
function updatePositions() {
    circles
        .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
}
function minutesSinceMidnight(date) { return date.getHours() * 60 + date.getMinutes(); }

function filterByMinute(tripsByMinute, minute) {
    // Normalize both to the [0, 1439] range
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}