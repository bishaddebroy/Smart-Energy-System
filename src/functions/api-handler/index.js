const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const HISTORICAL_BUCKET = process.env.HISTORICAL_BUCKET;

/**
 * API Handler Lambda function
 * Processes API requests from the web dashboard
 */
exports.handler = async (event) => {
  console.log('API Handler Lambda invoked:', JSON.stringify(event));
  
  try {
    // Enable CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Content-Type': 'application/json'
    };
    
    // Handle OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'CORS enabled' })
      };
    }
    
    // Extract query parameters
    const queryParams = event.queryStringParameters || {};
    const action = queryParams.action || 'current';
    
    let result;
    
    // Route to appropriate handler based on action
    switch (action) {
      case 'current':
        result = await getCurrentReadings(queryParams);
        break;
      case 'building':
        result = await getBuildingData(queryParams);
        break;
      case 'historical':
        result = await getHistoricalData(queryParams);
        break;
      case 'summary':
        result = await getSummaryData(queryParams);
        break;
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: 'Invalid action specified' })
        };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error processing API request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Error processing request',
        error: error.message
      })
    };
  }
};

/**
 * Gets the most recent energy readings for all buildings
 */
async function getCurrentReadings(params) {
  // Use a scan operation with a limit to get the most recent data
  // Note: In a production environment, we would optimize this query
  const scanParams = {
    TableName: TABLE_NAME,
    Limit: 20, // This should be enough to get the latest reading for each building
    ScanIndexForward: false // Descending order (newest first)
  };
  
  const result = await dynamoDB.scan(scanParams).promise();
  
  // Process results to get the latest reading for each building
  const buildingMap = new Map();
  
  result.Items.forEach(item => {
    if (!buildingMap.has(item.buildingId) || 
        new Date(item.timestamp) > new Date(buildingMap.get(item.buildingId).timestamp)) {
      buildingMap.set(item.buildingId, item);
    }
  });
  
  // Convert map to array
  const latestReadings = Array.from(buildingMap.values());
  
  // Calculate total energy consumption and cost
  const totalEnergy = latestReadings.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalCost = latestReadings.reduce((sum, item) => sum + item.cost, 0);
  
  return {
    timestamp: new Date().toISOString(),
    readings: latestReadings,
    summary: {
      buildingCount: latestReadings.length,
      totalEnergyKwh: Math.round(totalEnergy * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100
    }
  };
}

/**
 * Gets data for a specific building
 */
async function getBuildingData(params) {
  // Validate required parameters
  if (!params.buildingId) {
    throw new Error('buildingId parameter is required');
  }
  
  // Query the most recent data for the specified building
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'buildingId = :bid',
    ExpressionAttributeValues: {
      ':bid': params.buildingId
    },
    Limit: 12, // Get last 12 readings (covers 1 hour with 5-minute intervals)
    ScanIndexForward: false // Descending order (newest first)
  };
  
  const result = await dynamoDB.query(queryParams).promise();
  
  // Calculate average values
  const readings = result.Items;
  const count = readings.length;
  
  if (count === 0) {
    return { message: 'No data found for specified building' };
  }
  
  const latestReading = readings[0];
  const avgEnergy = readings.reduce((sum, item) => sum + item.energyKwh, 0) / count;
  const avgOccupancy = readings.reduce((sum, item) => sum + item.occupancy, 0) / count;
  const avgTemperature = readings.reduce((sum, item) => sum + item.temperature, 0) / count;
  
  return {
    buildingId: params.buildingId,
    buildingName: latestReading.buildingName,
    buildingType: latestReading.buildingType,
    timestamp: new Date().toISOString(),
    latest: latestReading,
    hourlyAverage: {
      energyKwh: Math.round(avgEnergy * 100) / 100,
      occupancy: Math.round(avgOccupancy),
      temperature: Math.round(avgTemperature * 10) / 10
    },
    readings: readings
  };
}

/**
 * Gets historical data from S3
 */
async function getHistoricalData(params) {
  // Validate required parameters
  if (!params.date) {
    throw new Error('date parameter is required (YYYY-MM-DD)');
  }
  
  // Parse the date parameter
  const date = params.date;
  const buildingId = params.buildingId; // Optional filter
  
  // Construct the S3 key based on the date
  // Assuming data is stored in YYYY/MM/DD format
  const [year, month, day] = date.split('-');
  const s3Key = `${year}/${month}/${day}/data.json`;
  
  try {
    // Try to get the file from S3
    const s3Params = {
      Bucket: HISTORICAL_BUCKET,
      Key: s3Key
    };
    
    const s3Response = await s3.getObject(s3Params).promise();
    const historicalData = JSON.parse(s3Response.Body.toString());
    
    // Filter by buildingId if specified
    if (buildingId) {
      historicalData.readings = historicalData.readings.filter(
        reading => reading.buildingId === buildingId
      );
    }
    
    return historicalData;
  } catch (error) {
    // If file doesn't exist in S3, try to get from DynamoDB instead
    if (error.code === 'NoSuchKey') {
      return await getHistoricalDataFromDynamoDB(date, buildingId);
    }
    throw error;
  }
}

/**
 * Fallback function to get historical data from DynamoDB if not in S3
 */
async function getHistoricalDataFromDynamoDB(date, buildingId) {
  // Create start and end timestamps for the date
  const startDate = new Date(`${date}T00:00:00Z`);
  const endDate = new Date(`${date}T23:59:59Z`);
  
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();
  
  // Query parameters depend on whether buildingId is specified
  let queryParams;
  
  if (buildingId) {
    // Query for specific building
    queryParams = {
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
  } else {
    // Scan for all buildings (less efficient)
    queryParams = {
      TableName: TABLE_NAME,
      FilterExpression: '#ts BETWEEN :start AND :end',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':start': startTimestamp,
        ':end': endTimestamp
      }
    };
  }
  
  // Execute query or scan
  let result;
  if (buildingId) {
    result = await dynamoDB.query(queryParams).promise();
  } else {
    result = await dynamoDB.scan(queryParams).promise();
  }
  
  return {
    date: date,
    source: 'dynamodb',
    readings: result.Items
  };
}

/**
 * Gets summary data for dashboard
 */
async function getSummaryData(params) {
  // Get period from params (default to 'day')
  const period = params.period || 'day';
  
  // Get the latest readings first
  const currentData = await getCurrentReadings(params);
  const latestReadings = currentData.readings;
  
  // Calculate summary based on period
  let summaryData = {};
  
  switch (period) {
    case 'day':
      // For daily summary, get hourly totals
      summaryData = await getDailySummary(latestReadings);
      break;
    case 'week':
      // For weekly summary, get daily totals
      summaryData = await getWeeklySummary();
      break;
    case 'month':
      // For monthly summary, get daily totals
      summaryData = await getMonthlySummary();
      break;
    default:
      summaryData = { message: 'Invalid period specified' };
  }
  
  // Return combined data
  return {
    timestamp: new Date().toISOString(),
    period: period,
    current: currentData.summary,
    summary: summaryData
  };
}

/**
 * Generates a daily summary with hourly data points
 */
async function getDailySummary(latestReadings) {
  // For simplicity in this example, we'll generate simulated hourly data
  // In a real implementation, this would query historical data
  
  const now = new Date();
  const currentHour = now.getHours();
  
  // Generate hourly data points for the current day
  const hourlyData = [];
  
  for (let hour = 0; hour <= currentHour; hour++) {
    // Create a variation of the latest readings for each hour
    const hourlyTotal = latestReadings.reduce((sum, building) => {
      // Create a realistic hourly pattern based on building type and hour
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
      
      // Adjust by building type
      if (building.buildingType === 'academic') {
        factor *= (hour >= 8 && hour <= 17) ? 1.3 : 0.5;
      } else if (building.buildingType === 'residential') {
        factor *= (hour >= 17 || hour <= 8) ? 1.4 : 0.7;
      }
      
      // Add some randomness
      factor *= (0.9 + Math.random() * 0.2);
      
      return sum + (building.energyKwh * factor);
    }, 0);
    
    // Format hour label (e.g., "08:00")
    const hourLabel = `${hour.toString().padStart(2, '0')}:00`;
    
    hourlyData.push({
      hour: hourLabel,
      energyKwh: Math.round(hourlyTotal * 100) / 100,
      cost: Math.round(hourlyTotal * 0.12 * 100) / 100
    });
  }
  
  // Calculate totals
  const totalEnergy = hourlyData.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalCost = hourlyData.reduce((sum, item) => sum + item.cost, 0);
  
  return {
    date: now.toISOString().split('T')[0],
    hourlyData: hourlyData,
    totals: {
      energyKwh: Math.round(totalEnergy * 100) / 100,
      cost: Math.round(totalCost * 100) / 100
    }
  };
}

/**
 * Generates a weekly summary with daily data points
 */
async function getWeeklySummary() {
  // For simplicity, generate simulated daily data
  // In a real implementation, this would query historical data
  
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  const dailyData = [];
  
  // Generate daily energy consumption for the past 7 days
  for (let i = 0; i < 7; i++) {
    const day = (currentDay - 6 + i + 7) % 7; // Calculate day of week (0-6)
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    
    // Base energy value - higher for weekdays, lower for weekends
    let baseEnergy = (day === 0 || day === 6) ? 1200 : 2200;
    
    // Add some randomness
    baseEnergy *= (0.9 + Math.random() * 0.2);
    
    // Format date as "YYYY-MM-DD"
    const dateStr = date.toISOString().split('T')[0];
    
    dailyData.push({
      date: dateStr,
      day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
      energyKwh: Math.round(baseEnergy * 100) / 100,
      cost: Math.round(baseEnergy * 0.12 * 100) / 100
    });
  }
  
  // Calculate totals
  const totalEnergy = dailyData.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalCost = dailyData.reduce((sum, item) => sum + item.cost, 0);
  
  return {
    startDate: dailyData[0].date,
    endDate: dailyData[6].date,
    dailyData: dailyData,
    totals: {
      energyKwh: Math.round(totalEnergy * 100) / 100,
      cost: Math.round(totalCost * 100) / 100
    }
  };
}

/**
 * Generates a monthly summary
 */
async function getMonthlySummary() {
  // For simplicity, generate simulated data
  // In a real implementation, this would query historical data from S3
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  
  // Get the number of days in the current month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const currentDay = Math.min(now.getDate(), daysInMonth);
  
  const dailyData = [];
  
  // Generate data for each day of the month up to the current day
  for (let day = 1; day <= currentDay; day++) {
    const date = new Date(currentYear, currentMonth, day);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Base energy value - higher for weekdays, lower for weekends
    let baseEnergy = (dayOfWeek === 0 || dayOfWeek === 6) ? 1200 : 2200;
    
    // Add some randomness
    baseEnergy *= (0.9 + Math.random() * 0.2);
    
    // Format date as "YYYY-MM-DD"
    const dateStr = date.toISOString().split('T')[0];
    
    dailyData.push({
      date: dateStr,
      day: day,
      energyKwh: Math.round(baseEnergy * 100) / 100,
      cost: Math.round(baseEnergy * 0.12 * 100) / 100
    });
  }
  
  // Calculate totals
  const totalEnergy = dailyData.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalCost = dailyData.reduce((sum, item) => sum + item.cost, 0);
  
  // Calculate average daily consumption
  const avgDailyEnergy = totalEnergy / currentDay;
  
  // Project monthly total based on daily average
  const projectedMonthlyEnergy = avgDailyEnergy * daysInMonth;
  const projectedMonthlyCost = projectedMonthlyEnergy * 0.12;
  
  return {
    year: currentYear,
    month: currentMonth + 1, // 1-12
    dailyData: dailyData,
    totals: {
      energyKwh: Math.round(totalEnergy * 100) / 100,
      cost: Math.round(totalCost * 100) / 100
    },
    projected: {
      energyKwh: Math.round(projectedMonthlyEnergy * 100) / 100,
      cost: Math.round(projectedMonthlyCost * 100) / 100
    }
  };
}