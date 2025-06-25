/**
 * Smart Campus Energy Management System
 * Main application JavaScript
 */

// Configuration
const CONFIG = {
  // API endpoint URL - replace with your actual API Gateway URL when deployed
  apiEndpoint: 'https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/dev/energy',
  
  // Dashboard refresh interval in milliseconds
  refreshInterval: 30000,
  
  // Chart colors
  chartColors: {
    primary: '#2e7d32',
    secondary: '#1565c0',
    accent: '#f57c00',
    light: '#60ad5e',
    dark: '#005005',
    danger: '#f44336',
    warning: '#ff9800',
    info: '#2196f3',
    gray: '#9e9e9e',
    chartBackground: 'rgba(46, 125, 50, 0.1)'
  }
};

// Global state for the application
const STATE = {
  currentPage: 'dashboard',
  currentTimePeriod: 'day',
  buildingData: [],
  currentData: null,
  charts: {},
  refreshTimer: null
};

// Main initialization function
document.addEventListener('DOMContentLoaded', () => {
  initializeNavigation();
  initializeModals();
  initializeTimeControls();
  
  // Load initial data and set up refresh timer
  loadDashboardData();
  STATE.refreshTimer = setInterval(loadDashboardData, CONFIG.refreshInterval);
  
  // Initialize the charts
  initializeCharts();
});

/**
 * Initialize navigation between pages
 */
function initializeNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetPage = item.getAttribute('data-page');
      
      // Update active nav item
      navItems.forEach(navItem => navItem.classList.remove('active'));
      item.classList.add('active');
      
      // Update active page
      const pages = document.querySelectorAll('.page');
      pages.forEach(page => page.classList.remove('active'));
      document.getElementById(`${targetPage}-page`).classList.add('active');
      
      // Update state
      STATE.currentPage = targetPage;
      
      // Load page-specific data
      if (targetPage === 'dashboard') {
        loadDashboardData();
      } else if (targetPage === 'buildings') {
        loadBuildingsData();
      } else if (targetPage === 'reports') {
        loadReportsData();
      } else if (targetPage === 'alerts') {
        loadAlertsData();
      }
    });
  });
}

/**
 * Initialize time period controls
 */
function initializeTimeControls() {
  const timeControls = document.querySelectorAll('.time-control');
  
  timeControls.forEach(control => {
    control.addEventListener('click', () => {
      const period = control.getAttribute('data-period');
      
      // Update active control
      timeControls.forEach(tc => tc.classList.remove('active'));
      control.classList.add('active');
      
      // Update state
      STATE.currentTimePeriod = period;
      
      // Reload data for the new time period
      loadDashboardData();
    });
  });
}

/**
 * Initialize modal functionality
 */
function initializeModals() {
  const modal = document.getElementById('building-detail-modal');
  const closeButtons = document.querySelectorAll('.modal-close, #modal-close-button');
  
  // Close modal when clicking close buttons
  closeButtons.forEach(button => {
    button.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  });
  
  // Close modal when clicking outside the content
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.classList.remove('active');
    }
  });
}

/**
 * Load dashboard data from the API
 */
async function loadDashboardData() {
  try {
    // Construct API URL with query parameters
    const url = `${CONFIG.apiEndpoint}?action=current`;
    
    // Fetch real data from the API
    const response = await fetch(url);
    const data = await response.json();
    
    // Update state with the new data
    STATE.currentData = data;
    STATE.buildingData = data.readings;
    
    // Update dashboard UI
    updateDashboardMetrics(data);
    updateBuildingList(data.readings);
    updateCharts();
    
    console.log('Dashboard data loaded:', data);
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    showError('Failed to load dashboard data. Please try again later.');
  }
}

/**
 * Update dashboard metrics with the latest data
 */
function updateDashboardMetrics(data) {
  // Update total energy
  document.getElementById('total-energy').textContent = 
    `${data.summary.totalEnergyKwh.toLocaleString()} kWh`;
  
  // Update total cost
  document.getElementById('total-cost').textContent = 
    `${data.summary.totalCost.toLocaleString()}`;
  
  // Update building count
  document.getElementById('building-count').textContent = 
    data.summary.buildingCount;
  
  // Calculate average temperature
  const avgTemp = data.readings.reduce((sum, building) => sum + building.temperature, 0) / data.readings.length;
  document.getElementById('avg-temperature').textContent = 
    `${avgTemp.toFixed(1)}°F`;
}

/**
 * Update the building list in the dashboard
 */
function updateBuildingList(buildings) {
  const buildingList = document.getElementById('building-list');
  
  // Clear existing content
  buildingList.innerHTML = '';
  
  // Sort buildings by energy consumption (highest first)
  const sortedBuildings = [...buildings].sort((a, b) => b.energyKwh - a.energyKwh);
  
  // Add building items
  sortedBuildings.forEach(building => {
    const buildingItem = document.createElement('div');
    buildingItem.className = 'building-item';
    buildingItem.dataset.id = building.buildingId;
    
    // Determine icon based on building type
    let icon = 'building';
    if (building.buildingType === 'academic') {
      icon = 'school';
    } else if (building.buildingType === 'residential') {
      icon = 'home';
    } else if (building.buildingType === 'laboratory') {
      icon = 'flask';
    } else if (building.buildingType === 'administrative') {
      icon = 'briefcase';
    }
    
    // Energy trend indicator - based on threshold of 150 kWh
    const trendDirection = building.energyKwh > 150 ? 'negative' : 'positive';
    const trendIcon = building.energyKwh > 150 ? 'arrow-up' : 'arrow-down';
    // We can't calculate real percentage change without historical data,
    // so we'll just indicate direction for now
    const trendText = building.energyKwh > 150 ? 'Above' : 'Below' + ' threshold';
    
    buildingItem.innerHTML = `
      <div class="building-icon">
        <i class="fas fa-${icon}"></i>
      </div>
      <div class="building-info">
        <h4>${building.buildingName}</h4>
        <p>${capitalizeFirstLetter(building.buildingType)}</p>
      </div>
      <div class="building-energy">
        <span class="energy-value">${building.energyKwh.toFixed(1)} kWh</span>
        <span class="energy-trend ${trendDirection}">
          <i class="fas fa-${trendIcon}"></i>
          ${trendText}
        </span>
      </div>
    `;
    
    // Add click handler to show building details
    buildingItem.addEventListener('click', () => showBuildingDetails(building));
    
    buildingList.appendChild(buildingItem);
  });
}

/**
 * Show building details in a modal
 */
function showBuildingDetails(building) {
  const modal = document.getElementById('building-detail-modal');
  
  // Update modal content
  document.getElementById('modal-building-name').textContent = building.buildingName;
  document.getElementById('modal-building-id').textContent = building.buildingId;
  document.getElementById('modal-building-type').textContent = 
    capitalizeFirstLetter(building.buildingType);
  document.getElementById('modal-building-energy').textContent = 
    `${building.energyKwh.toFixed(1)} kWh`;
  document.getElementById('modal-building-temperature').textContent = 
    `${building.temperature.toFixed(1)}°F`;
  
  // Fetch detailed building data
  fetchBuildingDetails(building.buildingId);
  
  // Show the modal
  modal.classList.add('active');
}

/**
 * Fetch detailed building data and update the chart
 */
async function fetchBuildingDetails(buildingId) {
  try {
    // Construct API URL for building details
    const url = `${CONFIG.apiEndpoint}?action=building&buildingId=${buildingId}`;
    
    // Show loading indicator in chart
    if (STATE.charts.buildingDetailChart) {
      STATE.charts.buildingDetailChart.data.labels = [];
      STATE.charts.buildingDetailChart.data.datasets[0].data = [];
      STATE.charts.buildingDetailChart.update();
    }
    
    // Fetch building details from API
    const response = await fetch(url);
    const data = await response.json();
    
    // Update the chart with the real data
    updateBuildingDetailChartWithData(data);
  } catch (error) {
    console.error('Error fetching building details:', error);
    
    // If error, show empty chart
    if (STATE.charts.buildingDetailChart) {
      STATE.charts.buildingDetailChart.data.labels = [];
      STATE.charts.buildingDetailChart.data.datasets[0].data = [];
      STATE.charts.buildingDetailChart.update();
    }
  }
}

/**
 * Update the building detail chart with real data
 */
function updateBuildingDetailChartWithData(buildingData) {
  if (!STATE.charts.buildingDetailChart) return;
  
  // Extract timestamps and energy values from readings
  const readings = buildingData.readings || [];
  
  // Sort readings by timestamp (oldest first)
  readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Format timestamps for display
  const labels = readings.map(reading => {
    const date = new Date(reading.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });
  
  // Extract energy values
  const data = readings.map(reading => reading.energyKwh);
  
  // Update chart
  STATE.charts.buildingDetailChart.data.labels = labels;
  STATE.charts.buildingDetailChart.data.datasets[0].data = data;
  STATE.charts.buildingDetailChart.update();
}

/**
 * Initialize charts on the dashboard
 */
function initializeCharts() {
  // Main energy consumption chart
  const energyChartCtx = document.getElementById('energy-chart').getContext('2d');
  STATE.charts.energyChart = new Chart(energyChartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Energy Consumption (kWh)',
        data: [],
        backgroundColor: CONFIG.chartColors.chartBackground,
        borderColor: CONFIG.chartColors.primary,
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: CONFIG.chartColors.primary,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        }
      }
    }
  });
  
  // Initialize reports page charts
  if (document.getElementById('daily-consumption-chart')) {
    const dailyChartCtx = document.getElementById('daily-consumption-chart').getContext('2d');
    STATE.charts.dailyChart = new Chart(dailyChartCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Daily Energy (kWh)',
          data: [],
          backgroundColor: CONFIG.chartColors.primary,
          borderColor: CONFIG.chartColors.dark,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
  
  if (document.getElementById('building-breakdown-chart')) {
    const breakdownChartCtx = document.getElementById('building-breakdown-chart').getContext('2d');
    STATE.charts.breakdownChart = new Chart(breakdownChartCtx, {
      type: 'pie',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [
            CONFIG.chartColors.primary,
            CONFIG.chartColors.secondary,
            CONFIG.chartColors.accent,
            CONFIG.chartColors.info,
            CONFIG.chartColors.warning
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
  
  // Building details chart in modal
  if (document.getElementById('modal-building-chart')) {
    const buildingChartCtx = document.getElementById('modal-building-chart').getContext('2d');
    STATE.charts.buildingDetailChart = new Chart(buildingChartCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Energy (kWh)',
          data: [],
          borderColor: CONFIG.chartColors.primary,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.4,
          pointBackgroundColor: CONFIG.chartColors.primary
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
}

/**
 * Update charts with the latest data
 */
function updateCharts() {
  // Update main energy chart based on the selected time period
  if (STATE.charts.energyChart) {
    fetchChartData(STATE.currentTimePeriod);
  }
}

/**
 * Fetch chart data based on selected time period
 */
async function fetchChartData(period) {
  try {
    // Construct API URL based on time period
    const url = `${CONFIG.apiEndpoint}?action=summary&period=${period}`;
    
    // Fetch data from API
    const response = await fetch(url);
    const data = await response.json();
    
    // Update chart with real data
    updateEnergyChartWithData(data, period);
  } catch (error) {
    console.error(`Error fetching ${period} chart data:`, error);
    
    // If error, clear chart
    if (STATE.charts.energyChart) {
      STATE.charts.energyChart.data.labels = [];
      STATE.charts.energyChart.data.datasets[0].data = [];
      STATE.charts.energyChart.update();
    }
  }
}

/**
 * Update energy chart with real data
 */
function updateEnergyChartWithData(data, period) {
  if (!STATE.charts.energyChart) return;
  
  let labels = [];
  let values = [];
  
  // Parse data based on period
  if (period === 'day' && data.summary && data.summary.hourlyData) {
    // Hourly data for the day
    labels = data.summary.hourlyData.map(item => item.hour);
    values = data.summary.hourlyData.map(item => item.energyKwh);
  } else if (period === 'week' && data.summary && data.summary.dailyData) {
    // Daily data for the week
    labels = data.summary.dailyData.map(item => item.day);
    values = data.summary.dailyData.map(item => item.energyKwh);
  } else if (period === 'month' && data.summary && data.summary.dailyData) {
    // Daily data for the month
    labels = data.summary.dailyData.map(item => `${item.day}`);
    values = data.summary.dailyData.map(item => item.energyKwh);
  }
  
  // Update chart
  STATE.charts.energyChart.data.labels = labels;
  STATE.charts.energyChart.data.datasets[0].data = values;
  STATE.charts.energyChart.update();
}

/**
 * Load buildings page data
 */
function loadBuildingsData() {
  try {
    // Use the building data we already have
    const buildingsGrid = document.getElementById('buildings-grid');
    
    // Clear existing content
    buildingsGrid.innerHTML = '';
    
    // Create building cards
    STATE.buildingData.forEach(building => {
      const buildingCard = document.createElement('div');
      buildingCard.className = 'building-card';
      
      // Determine icon based on building type
      let icon = 'building';
      if (building.buildingType === 'academic') {
        icon = 'school';
      } else if (building.buildingType === 'residential') {
        icon = 'home';
      } else if (building.buildingType === 'laboratory') {
        icon = 'flask';
      } else if (building.buildingType === 'administrative') {
        icon = 'briefcase';
      }
      
      buildingCard.innerHTML = `
        <div class="building-card-header">
          <h3>${building.buildingName}</h3>
          <div class="building-type">${capitalizeFirstLetter(building.buildingType)}</div>
          <div class="building-actions">
            <button class="action-button">
              <i class="fas fa-ellipsis-v"></i>
            </button>
          </div>
        </div>
        <div class="building-card-body">
          <div class="building-metrics">
            <div class="building-metric">
              <div class="building-metric-value">${building.energyKwh.toFixed(1)}</div>
              <div class="building-metric-label">Energy (kWh)</div>
            </div>
            <div class="building-metric">
              <div class="building-metric-value">${building.cost.toFixed(2)}</div>
              <div class="building-metric-label">Cost</div>
            </div>
            <div class="building-metric">
              <div class="building-metric-value">${building.temperature.toFixed(1)}°F</div>
              <div class="building-metric-label">Temperature</div>
            </div>
            <div class="building-metric">
              <div class="building-metric-value">${building.occupancy}</div>
              <div class="building-metric-label">Occupancy</div>
            </div>
          </div>
          <div class="building-chart">
            <canvas id="building-chart-${building.buildingId}"></canvas>
          </div>
        </div>
        <div class="building-card-footer">
          <button class="secondary-button">History</button>
          <button class="primary-button" data-building-id="${building.buildingId}">Manage</button>
        </div>
      `;
      
      buildingsGrid.appendChild(buildingCard);
      
      // Fetch building data for the chart
      fetchBuildingChartData(building.buildingId);
      
      // Add click handler for Manage button
      buildingCard.querySelector('.primary-button').addEventListener('click', (e) => {
        const buildingId = e.target.getAttribute('data-building-id');
        const buildingData = STATE.buildingData.find(b => b.buildingId === buildingId);
        if (buildingData) {
          showBuildingDetails(buildingData);
        }
      });
    });
  } catch (error) {
    console.error('Error loading buildings data:', error);
    showError('Failed to load buildings data. Please try again later.');
  }
}

/**
 * Fetch data for building chart
 */
async function fetchBuildingChartData(buildingId) {
  try {
    // Construct API URL for building data
    const url = `${CONFIG.apiEndpoint}?action=building&buildingId=${buildingId}`;
    
    // Fetch data from API
    const response = await fetch(url);
    const data = await response.json();
    
    // Initialize chart with the fetched data
    initializeBuildingChart(buildingId, data);
  } catch (error) {
    console.error(`Error fetching chart data for building ${buildingId}:`, error);
    
    // Initialize chart with empty data on error
    initializeBuildingChart(buildingId, { readings: [] });
  }
}

/**
 * Initialize chart for a building
 */
function initializeBuildingChart(buildingId, data) {
  const chartElement = document.getElementById(`building-chart-${buildingId}`);
  if (!chartElement) return;
  
  const chartCtx = chartElement.getContext('2d');
  
  // Extract data from readings
  const readings = data.readings || [];
  
  // Sort readings by timestamp (oldest first)
  readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Format timestamps for display (show only last 6 readings for clarity)
  const displayReadings = readings.slice(-6);
  const labels = displayReadings.map(reading => {
    const date = new Date(reading.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });
  
  // Extract energy values
  const values = displayReadings.map(reading => reading.energyKwh);
  
  new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Energy (kWh)',
        data: values,
        borderColor: CONFIG.chartColors.primary,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          }
        },
        y: {
          display: false,
          beginAtZero: false
        }
      }
    }
  });
}

/**
 * Load reports page data
 */
async function loadReportsData() {
  try {
    // Fetch report data from API
    const url = `${CONFIG.apiEndpoint}?action=summary&period=month`;
    
    // Fetch data
    const response = await fetch(url);
    const data = await response.json();
    
    // Update daily consumption chart
    if (STATE.charts.dailyChart && data.summary && data.summary.dailyData) {
      const labels = data.summary.dailyData.map(item => `${item.date}`);
      const values = data.summary.dailyData.map(item => item.energyKwh);
      
      STATE.charts.dailyChart.data.labels = labels;
      STATE.charts.dailyChart.data.datasets[0].data = values;
      STATE.charts.dailyChart.update();
    }
    
    // Update building breakdown chart
    if (STATE.charts.breakdownChart) {
      const labels = STATE.buildingData.map(building => building.buildingName);
      const values = STATE.buildingData.map(building => building.energyKwh);
      
      STATE.charts.breakdownChart.data.labels = labels;
      STATE.charts.breakdownChart.data.datasets[0].data = values;
      STATE.charts.breakdownChart.update();
    }
    
    // Update summary metrics in the report page
    updateReportSummary(data);
  } catch (error) {
    console.error('Error loading reports data:', error);
    showError('Failed to load reports data. Please try again later.');
  }
}

/**
 * Update report summary metrics
 */
function updateReportSummary(data) {
  // Check if we have the necessary elements and data
  if (!data.summary) return;
  
  const summaryMetrics = document.querySelector('.summary-metrics');
  if (!summaryMetrics) return;
  
  // Find the metric elements
  const totalEnergyElement = summaryMetrics.querySelector('.summary-metric:nth-child(1) .metric-value');
  const totalCostElement = summaryMetrics.querySelector('.summary-metric:nth-child(2) .metric-value');
  const avgDailyElement = summaryMetrics.querySelector('.summary-metric:nth-child(3) .metric-value');
  const peakDayElement = summaryMetrics.querySelector('.summary-metric:nth-child(4) .metric-value');
  
  // Update with real data if available
  if (totalEnergyElement && data.summary.totals) {
    totalEnergyElement.textContent = `${data.summary.totals.energyKwh.toLocaleString()} kWh`;
  }
  
  if (totalCostElement && data.summary.totals) {
    totalCostElement.textContent = `${data.summary.totals.cost.toLocaleString()}`;
  }
  
  if (avgDailyElement && data.summary.dailyData) {
    // Calculate average daily consumption
    const totalDays = data.summary.dailyData.length;
    const totalEnergy = data.summary.dailyData.reduce((sum, day) => sum + day.energyKwh, 0);
    const avgDaily = totalDays > 0 ? totalEnergy / totalDays : 0;
    
    avgDailyElement.textContent = `${avgDaily.toLocaleString()} kWh`;
  }
  
  if (peakDayElement && data.summary.dailyData && data.summary.dailyData.length > 0) {
    // Find peak day
    const peakDay = data.summary.dailyData.reduce((max, day) => 
      day.energyKwh > max.energyKwh ? day : max, data.summary.dailyData[0]);
    
    const peakDate = new Date(peakDay.date);
    const formattedDate = peakDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    peakDayElement.textContent = `${formattedDate} (${peakDay.energyKwh.toLocaleString()} kWh)`;
  }
}

/**
 * Load alerts page data
 */
async function loadAlertsData() {
  try {
    // In a real implementation, we would fetch alerts from an API endpoint
    // For now, we'll use the placeholder alerts already in the HTML
    
    // Fetch alert data from API (if implemented)
    // const url = `${CONFIG.apiEndpoint}?action=alerts`;
    // const response = await fetch(url);
    // const data = await response.json();
    
    // Update alerts table
    // updateAlertsTable(data);
    
    console.log('Alerts data loaded');
  } catch (error) {
    console.error('Error loading alerts data:', error);
  }
}

/**
 * Helper function to capitalize the first letter of a string
 */
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Show an error message to the user
 */
function showError(message) {
  // In a real application, you would show a proper error notification
  console.error(message);
  alert(message);
}