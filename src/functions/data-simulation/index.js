const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cloudWatch = new AWS.CloudWatch();

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30');

// Building definitions
const BUILDINGS = [
  { 
    id: 'academic-01', 
    name: 'Rowe Building', 
    type: 'academic',
    capacity: 2500,
    floors: 5,
    baseLoad: 75,
    peakMultiplier: 3.5
  },
  { 
    id: 'academic-02', 
    name: 'Goldberg Computer Science Building', 
    type: 'academic',
    capacity: 1800,
    floors: 4,
    baseLoad: 120,
    peakMultiplier: 2.8
  },
  { 
    id: 'residential-01', 
    name: 'Howe Hall', 
    type: 'residential',
    capacity: 350,
    floors: 6,
    baseLoad: 45,
    peakMultiplier: 2.2
  },
  { 
    id: 'lab-01', 
    name: 'Chemistry Research Center', 
    type: 'laboratory',
    capacity: 120,
    floors: 3,
    baseLoad: 200,
    peakMultiplier: 1.8
  },
  { 
    id: 'admin-01', 
    name: 'Student Union Building', 
    type: 'administrative',
    capacity: 800,
    floors: 3,
    baseLoad: 60,
    peakMultiplier: 2.5
  }
];

/**
 * Generates simulated energy data for campus buildings
 */
exports.handler = async (event) => {
  console.log('Data Simulation Lambda invoked:', JSON.stringify(event));
  
  try {
    // Current time
    const now = new Date();
    const timestamp = now.toISOString();
    const unixTimestamp = Math.floor(now.getTime() / 1000);
    
    // TTL for DynamoDB (current time + retention days)
    const ttl = unixTimestamp + (RETENTION_DAYS * 24 * 60 * 60);
    
    // Generate and store data for each building
    const promises = BUILDINGS.map(building => generateAndStoreData(building, timestamp, ttl, now));
    await Promise.all(promises);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Energy data generated successfully',
        timestamp,
        buildingCount: BUILDINGS.length
      })
    };
  } catch (error) {
    console.error('Error generating energy data:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error generating energy data',
        error: error.message
      })
    };
  }
};

/**
 * Generates and stores energy data for a single building
 */
async function generateAndStoreData(building, timestamp, ttl, date) {
  // Generate simulated energy data
  const data = simulateEnergyData(building, date);
  
  // Store in DynamoDB
  const params = {
    TableName: TABLE_NAME,
    Item: {
      buildingId: building.id,
      timestamp: timestamp,
      buildingName: building.name,
      buildingType: building.type,
      energyKwh: data.energyKwh,
      temperature: data.temperature,
      occupancy: data.occupancy,
      cost: data.cost,
      ttl: ttl
    }
  };
  
  await dynamoDB.put(params).promise();
  
  // Log metrics to CloudWatch
  await logMetricsToCloudWatch(building, data);
  
  console.log(`Generated data for ${building.name}: ${data.energyKwh} kWh`);
  return data;
}

/**
 * Simulates energy consumption based on building type, time of day, and other factors
 */
function simulateEnergyData(building, date) {
  // Time-based factors
  const hour = date.getHours();
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // Calculate occupancy based on time of day and building type
  let occupancyRate = calculateOccupancy(hour, dayOfWeek, building.type);
  
  // Base temperature is between 68-74°F with some random variation
  const baseTemp = 68 + Math.random() * 6;
  
  // Temperature varies slightly based on occupancy and time
  const temperature = Math.round((baseTemp + (occupancyRate * 2)) * 10) / 10;
  
  // Calculate actual occupancy count
  const occupancy = Math.round(building.capacity * occupancyRate);
  
  // Calculate energy consumption
  let energyKwh = calculateEnergy(building, occupancyRate, hour, isWeekend);
  
  // Add some random variation (±5%)
  energyKwh = energyKwh * (0.95 + Math.random() * 0.1);
  
  // Round to 2 decimal places
  energyKwh = Math.round(energyKwh * 100) / 100;
  
  // Calculate cost ($0.12 per kWh)
  const cost = Math.round(energyKwh * 0.12 * 100) / 100;
  
  return {
    energyKwh,
    temperature,
    occupancy,
    cost
  };
}

/**
 * Calculates building occupancy rate based on time and building type
 */
function calculateOccupancy(hour, dayOfWeek, buildingType) {
  // Weekend occupancy is much lower
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  if (isWeekend) {
    // Weekend occupancy patterns
    if (buildingType === 'residential') {
      // Residential buildings have different patterns on weekends
      if (hour < 8) return 0.7; // Most students sleeping
      if (hour < 12) return 0.4; // Some students going out
      if (hour < 17) return 0.3; // Many students out during day
      if (hour < 22) return 0.5; // Some return in evening
      return 0.6; // Night time
    } else if (buildingType === 'laboratory') {
      // Some researchers come in on weekends
      if (hour < 8) return 0.05;
      if (hour < 18) return 0.2;
      return 0.05;
    } else {
      // Other buildings mostly empty on weekends
      if (hour < 8) return 0;
      if (hour < 18) return 0.1;
      return 0;
    }
  } else {
    // Weekday occupancy patterns
    if (buildingType === 'academic') {
      // Academic buildings - classes during day
      if (hour < 7) return 0.05;
      if (hour < 9) return 0.3;
      if (hour < 16) return 0.85;
      if (hour < 20) return 0.4;
      return 0.1;
    } else if (buildingType === 'residential') {
      // Residential buildings - inverse pattern to academic
      if (hour < 7) return 0.8;
      if (hour < 9) return 0.5;
      if (hour < 16) return 0.2;
      if (hour < 20) return 0.6;
      return 0.75;
    } else if (buildingType === 'laboratory') {
      // Labs - more constant usage
      if (hour < 7) return 0.1;
      if (hour < 9) return 0.4;
      if (hour < 18) return 0.7;
      if (hour < 22) return 0.3;
      return 0.1;
    } else if (buildingType === 'administrative') {
      // Admin buildings - standard office hours
      if (hour < 7) return 0.05;
      if (hour < 9) return 0.5;
      if (hour < 17) return 0.9;
      if (hour < 19) return 0.3;
      return 0.05;
    }
  }
  
  // Default case
  return 0.2;
}

/**
 * Calculates energy consumption based on building characteristics and occupancy
 */
function calculateEnergy(building, occupancyRate, hour, isWeekend) {
  // Base load is always present (lights, servers, etc)
  let energy = building.baseLoad;
  
  // Add occupancy-based consumption
  energy += (building.capacity * occupancyRate * 0.1);
  
  // Add time-of-day factor
  if (hour >= 8 && hour <= 17) {
    // Peak hours
    energy *= (isWeekend ? 1.2 : building.peakMultiplier);
  } else if (hour >= 18 && hour <= 22) {
    // Evening hours
    energy *= (isWeekend ? 1.1 : 1.5);
  } else {
    // Night hours
    energy *= 1.0;
  }
  
  // Scale by building size (floors)
  energy *= (0.8 + (building.floors * 0.05));
  
  return energy;
}

/**
 * Logs energy metrics to CloudWatch for monitoring and alerting
 */
async function logMetricsToCloudWatch(building, data) {
  const params = {
    MetricData: [
      {
        MetricName: 'EnergyConsumption',
        Dimensions: [
          {
            Name: 'BuildingId',
            Value: building.id
          },
          {
            Name: 'BuildingType',
            Value: building.type
          }
        ],
        Unit: 'Count',
        Value: data.energyKwh
      },
      {
        MetricName: 'Temperature',
        Dimensions: [
          {
            Name: 'BuildingId',
            Value: building.id
          }
        ],
        Unit: 'Count',
        Value: data.temperature
      },
      {
        MetricName: 'Occupancy',
        Dimensions: [
          {
            Name: 'BuildingId',
            Value: building.id
          }
        ],
        Unit: 'Count',
        Value: data.occupancy
      }
    ],
    Namespace: 'SmartCampus'
  };
  
  try {
    await cloudWatch.putMetricData(params).promise();
  } catch (error) {
    console.error('Error logging metrics to CloudWatch:', error);
    // Don't throw error - we don't want to fail the main function if metrics logging fails
  }
}