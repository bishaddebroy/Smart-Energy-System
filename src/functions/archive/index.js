const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;

/**
 * Archives data from DynamoDB to S3
 * Runs daily to export data before TTL expiration
 */
exports.handler = async (event) => {
  console.log('Archive Lambda invoked:', JSON.stringify(event));
  
  try {
    // Calculate date ranges for archiving
    // We'll archive data from the previous day
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Format dates for file paths and queries
    const year = yesterday.getFullYear();
    const month = (yesterday.getMonth() + 1).toString().padStart(2, '0');
    const day = yesterday.getDate().toString().padStart(2, '0');
    
    const dateStr = `${year}-${month}-${day}`;
    const s3KeyPrefix = `${year}/${month}/${day}`;
    
    console.log(`Archiving data for ${dateStr}`);
    
    // Get all buildings to process
    const buildings = await getAllBuildings();
    console.log(`Found ${buildings.length} buildings to process`);
    
    // Process each building's data
    const buildingPromises = buildings.map(buildingId => 
      archiveBuildingData(buildingId, dateStr, s3KeyPrefix)
    );
    
    // Wait for all building data to be processed
    const results = await Promise.all(buildingPromises);
    
    // Create a summary of all data for the day
    await createDailySummary(results, dateStr, s3KeyPrefix);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Archive process completed successfully',
        date: dateStr,
        buildingsProcessed: buildings.length,
        totalRecords: results.reduce((sum, result) => sum + result.count, 0)
      })
    };
  } catch (error) {
    console.error('Error in archive process:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error in archive process',
        error: error.message
      })
    };
  }
};

/**
 * Gets a list of all building IDs in the system
 */
async function getAllBuildings() {
  // Perform a scan to get unique building IDs
  // Note: In a production system with many buildings, this approach would need optimization
  const params = {
    TableName: TABLE_NAME,
    ProjectionExpression: 'buildingId',
  };
  
  const data = await dynamoDB.scan(params).promise();
  
  // Extract unique building IDs
  const buildingIds = new Set();
  data.Items.forEach(item => buildingIds.add(item.buildingId));
  
  return Array.from(buildingIds);
}

/**
 * Archives data for a specific building
 */
async function archiveBuildingData(buildingId, dateStr, s3KeyPrefix) {
  // Set up time range for the day
  const startTimestamp = `${dateStr}T00:00:00Z`;
  const endTimestamp = `${dateStr}T23:59:59Z`;
  
  // Query parameters to get data for this building on the specified date
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'buildingId = :bid AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: {
      '#ts': 'timestamp'
    },
    ExpressionAttributeValues: {
      ':bid': buildingId,
      ':start': startTimestamp,
      ':end': endTimestamp
    }
  };
  
  // Query DynamoDB
  const data = await dynamoDB.query(queryParams).promise();
  const items = data.Items;
  
  if (items.length === 0) {
    console.log(`No data found for building ${buildingId} on ${dateStr}`);
    return { buildingId, count: 0 };
  }
  
  // Prepare the data for S3
  const buildingData = {
    buildingId: buildingId,
    date: dateStr,
    readings: items
  };
  
  // Calculate some building metrics
  buildingData.metrics = calculateBuildingMetrics(items);
  
  // Save to S3
  const s3Params = {
    Bucket: BUCKET_NAME,
    Key: `${s3KeyPrefix}/buildings/${buildingId}.json`,
    Body: JSON.stringify(buildingData, null, 2),
    ContentType: 'application/json'
  };
  
  await s3.putObject(s3Params).promise();
  
  console.log(`Archived ${items.length} records for building ${buildingId} to S3`);
  return { buildingId, count: items.length, metrics: buildingData.metrics };
}

/**
 * Creates a daily summary file with data from all buildings
 */
async function createDailySummary(buildingResults, dateStr, s3KeyPrefix) {
  // Skip if no data was processed
  if (buildingResults.length === 0 || buildingResults.every(r => r.count === 0)) {
    console.log(`No data to summarize for ${dateStr}`);
    return;
  }
  
  // Create summary object
  const summary = {
    date: dateStr,
    generated: new Date().toISOString(),
    buildings: buildingResults.filter(r => r.count > 0).map(r => ({
      buildingId: r.buildingId,
      recordCount: r.count,
      metrics: r.metrics
    })),
    totals: {
      buildingCount: buildingResults.filter(r => r.count > 0).length,
      recordCount: buildingResults.reduce((sum, r) => sum + r.count, 0),
      totalEnergyKwh: buildingResults.reduce((sum, r) => 
        sum + (r.metrics ? r.metrics.totalEnergyKwh : 0), 0),
      totalCost: buildingResults.reduce((sum, r) => 
        sum + (r.metrics ? r.metrics.totalCost : 0), 0),
      averageTemperature: calculateAverageMetric(buildingResults, 'averageTemperature'),
      averageOccupancy: calculateAverageMetric(buildingResults, 'averageOccupancy')
    }
  };
  
  // Round numeric values for better readability
  summary.totals.totalEnergyKwh = Math.round(summary.totals.totalEnergyKwh * 100) / 100;
  summary.totals.totalCost = Math.round(summary.totals.totalCost * 100) / 100;
  summary.totals.averageTemperature = Math.round(summary.totals.averageTemperature * 10) / 10;
  summary.totals.averageOccupancy = Math.round(summary.totals.averageOccupancy);
  
  // Save summary to S3
  const s3Params = {
    Bucket: BUCKET_NAME,
    Key: `${s3KeyPrefix}/summary.json`,
    Body: JSON.stringify(summary, null, 2),
    ContentType: 'application/json'
  };
  
  await s3.putObject(s3Params).promise();
  console.log(`Created daily summary for ${dateStr}`);
  
  // Also save the data in a flattened format for easy querying
  await createFlattenedData(buildingResults, dateStr, s3KeyPrefix);
}

/**
 * Creates a flattened data file for easy analysis
 */
async function createFlattenedData(buildingResults, dateStr, s3KeyPrefix) {
  // Skip if no data
  if (buildingResults.length === 0 || buildingResults.every(r => r.count === 0)) {
    return;
  }
  
  // Create a CSV file with hourly data for all buildings
  const flatData = {
    date: dateStr,
    hourlyData: []
  };
  
  // Get buildings with data
  const buildingsWithData = buildingResults.filter(r => r.count > 0 && r.metrics);
  
  // For each hour of the day
  for (let hour = 0; hour < 24; hour++) {
    const hourString = hour.toString().padStart(2, '0');
    
    // For each building, calculate the hourly total
    // Note: This is a simplified approach - in a real system, we would query the actual hourly data
    const hourlyTotal = buildingsWithData.reduce((sum, building) => {
      // Apply time-of-day factor based on metrics
      let factor = 1.0;
      
      if (hour < 8) {
        factor = 0.6; // Early morning - low usage
      } else if (hour < 12) {
        factor = 1.2; // Morning - higher usage
      } else if (hour < 17) {
        factor = 1.5; // Afternoon - peak usage
      } else if (hour < 22) {
        factor = 0.9; // Evening - moderate usage
      } else {
        factor = 0.5; // Night - low usage
      }
      
      return sum + (building.metrics.avgEnergyKwh * factor);
    }, 0);
    
    flatData.hourlyData.push({
      hour: `${hourString}:00`,
      energyKwh: Math.round(hourlyTotal * 100) / 100,
      cost: Math.round(hourlyTotal * 0.12 * 100) / 100
    });
  }
  
  // Save flattened data to S3
  const s3Params = {
    Bucket: BUCKET_NAME,
    Key: `${s3KeyPrefix}/hourly-data.json`,
    Body: JSON.stringify(flatData, null, 2),
    ContentType: 'application/json'
  };
  
  await s3.putObject(s3Params).promise();
  console.log(`Created flattened hourly data for ${dateStr}`);
}

/**
 * Calculates metrics for a building based on its readings
 */
function calculateBuildingMetrics(readings) {
  if (!readings || readings.length === 0) {
    return null;
  }
  
  // Get the latest reading (to extract building metadata)
  const latestReading = readings[0];
  
  // Calculate total energy and cost
  const totalEnergyKwh = readings.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalCost = readings.reduce((sum, item) => sum + item.cost, 0);
  
  // Calculate averages
  const avgEnergyKwh = totalEnergyKwh / readings.length;
  const avgTemperature = readings.reduce((sum, item) => sum + item.temperature, 0) / readings.length;
  const avgOccupancy = readings.reduce((sum, item) => sum + item.occupancy, 0) / readings.length;
  
  // Find min and max values
  const minEnergyKwh = Math.min(...readings.map(item => item.energyKwh));
  const maxEnergyKwh = Math.max(...readings.map(item => item.energyKwh));
  
  return {
    buildingName: latestReading.buildingName,
    buildingType: latestReading.buildingType,
    readingCount: readings.length,
    totalEnergyKwh: Math.round(totalEnergyKwh * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    avgEnergyKwh: Math.round(avgEnergyKwh * 100) / 100,
    minEnergyKwh: Math.round(minEnergyKwh * 100) / 100,
    maxEnergyKwh: Math.round(maxEnergyKwh * 100) / 100,
    averageTemperature: Math.round(avgTemperature * 10) / 10,
    averageOccupancy: Math.round(avgOccupancy)
  };
}

/**
 * Calculates the average of a specific metric across multiple buildings
 */
function calculateAverageMetric(buildingResults, metricName) {
  const buildingsWithMetric = buildingResults.filter(r => r.metrics && r.metrics[metricName]);
  
  if (buildingsWithMetric.length === 0) {
    return 0;
  }
  
  const sum = buildingsWithMetric.reduce((total, r) => total + r.metrics[metricName], 0);
  return sum / buildingsWithMetric.length;
}