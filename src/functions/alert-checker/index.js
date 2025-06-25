const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sns = new AWS.SNS();
const cloudWatch = new AWS.CloudWatch();

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const SNS_TOPIC = process.env.SNS_TOPIC;

// Alert thresholds
const THRESHOLDS = {
  energy: {
    academic: 200,    // kWh threshold for academic buildings
    residential: 150,  // kWh threshold for residential buildings
    laboratory: 300,   // kWh threshold for laboratory buildings
    administrative: 180 // kWh threshold for administrative buildings
  },
  temperature: {
    min: 65, // °F
    max: 78  // °F
  },
  occupancy: {
    percentage: 0.9 // 90% of capacity
  }
};

/**
 * Alert Checker Lambda function
 * Monitors energy data for anomalies and triggers alerts
 */
exports.handler = async (event) => {
  console.log('Alert Checker Lambda invoked:', JSON.stringify(event));
  
  try {
    // Process DynamoDB stream event if available
    if (event.Records && event.Records.length > 0) {
      // This is a DynamoDB stream event
      return await processDynamoDBStreamEvent(event);
    }
    
    // Otherwise, perform scheduled check
    return await performScheduledCheck();
  } catch (error) {
    console.error('Error in alert checker:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing alerts',
        error: error.message
      })
    };
  }
};

/**
 * Processes alerts from DynamoDB stream events
 */
async function processDynamoDBStreamEvent(event) {
  console.log('Processing DynamoDB Stream event');
  
  // Process each record in the stream
  const alertPromises = event.Records.map(async (record) => {
    // Only process INSERT or MODIFY events
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
      return null;
    }
    
    // Parse the new image (the new version of the item)
    const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
    
    // Check for alerts
    return await checkForAlerts(newImage);
  });
  
  // Wait for all alert checks to complete
  const results = await Promise.all(alertPromises);
  
  // Filter out null results and count alerts
  const alerts = results.filter(result => result !== null);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Stream processing completed',
      recordsProcessed: event.Records.length,
      alertsGenerated: alerts.length
    })
  };
}

/**
 * Performs a scheduled check of recent data
 */
async function performScheduledCheck() {
  console.log('Performing scheduled alert check');
  
  // Get recent readings for all buildings
  const scanParams = {
    TableName: TABLE_NAME,
    Limit: 50, // Limit to most recent readings
    ScanIndexForward: false // Descending order (newest first)
  };
  
  const result = await dynamoDB.scan(scanParams).promise();
  const items = result.Items;
  
  console.log(`Retrieved ${items.length} recent readings`);
  
  // Process each item for alerts
  const alertPromises = items.map(item => checkForAlerts(item));
  const results = await Promise.all(alertPromises);
  
  // Filter out null results and count alerts
  const alerts = results.filter(result => result !== null);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Scheduled check completed',
      readingsChecked: items.length,
      alertsGenerated: alerts.length
    })
  };
}

/**
 * Checks a single reading for alert conditions
 */
async function checkForAlerts(reading) {
  // Get building type to determine appropriate thresholds
  const buildingType = reading.buildingType;
  const buildingId = reading.buildingId;
  const buildingName = reading.buildingName;
  
  // Track if we should send an alert
  let shouldAlert = false;
  let alertMessages = [];
  
  // 1. Check energy consumption
  const energyThreshold = THRESHOLDS.energy[buildingType] || THRESHOLDS.energy.academic;
  if (reading.energyKwh > energyThreshold) {
    shouldAlert = true;
    alertMessages.push(`High energy consumption: ${reading.energyKwh} kWh (threshold: ${energyThreshold} kWh)`);
  }
  
  // 2. Check temperature
  if (reading.temperature < THRESHOLDS.temperature.min) {
    shouldAlert = true;
    alertMessages.push(`Low temperature: ${reading.temperature}°F (minimum: ${THRESHOLDS.temperature.min}°F)`);
  } else if (reading.temperature > THRESHOLDS.temperature.max) {
    shouldAlert = true;
    alertMessages.push(`High temperature: ${reading.temperature}°F (maximum: ${THRESHOLDS.temperature.max}°F)`);
  }
  
  // 3. Check occupancy (if capacity information is available)
  // Skip this check in the simulation since we don't have building capacity data
  
  // If any alert conditions were met, send an alert
  if (shouldAlert) {
    await sendAlert(buildingId, buildingName, buildingType, alertMessages, reading);
    return {
      buildingId,
      timestamp: reading.timestamp,
      alerts: alertMessages
    };
  }
  
  return null;
}

/**
 * Sends an alert notification
 */
async function sendAlert(buildingId, buildingName, buildingType, alertMessages, reading) {
  console.log(`Sending alert for ${buildingName} (${buildingId}): ${alertMessages.join(', ')}`);
  
  // Format the alert message
  const message = {
    alertType: 'EnergyConsumptionAlert',
    timestamp: new Date().toISOString(),
    building: {
      id: buildingId,
      name: buildingName,
      type: buildingType
    },
    reading: {
      timestamp: reading.timestamp,
      energyKwh: reading.energyKwh,
      temperature: reading.temperature,
      occupancy: reading.occupancy,
      cost: reading.cost
    },
    alerts: alertMessages,
    dashboardLink: process.env.DASHBOARD_URL || 'https://example.com/dashboard'
  };
  
  // Prepare SNS message
  const params = {
    TopicArn: SNS_TOPIC,
    Subject: `Energy Alert: ${buildingName}`,
    Message: JSON.stringify(message, null, 2),
    MessageAttributes: {
      'BuildingId': {
        DataType: 'String',
        StringValue: buildingId
      },
      'BuildingType': {
        DataType: 'String',
        StringValue: buildingType
      },
      'AlertType': {
        DataType: 'String',
        StringValue: 'EnergyConsumptionAlert'
      }
    }
  };
  
  // Send the SNS notification
  await sns.publish(params).promise();
  
  // Log an alert metric to CloudWatch
  await logAlertMetric(buildingId, buildingType, alertMessages);
}

/**
 * Logs an alert metric to CloudWatch
 */
async function logAlertMetric(buildingId, buildingType, alertMessages) {
  // Prepare CloudWatch metric data
  const params = {
    MetricData: [
      {
        MetricName: 'EnergyAlerts',
        Dimensions: [
          {
            Name: 'BuildingId',
            Value: buildingId
          },
          {
            Name: 'BuildingType',
            Value: buildingType
          }
        ],
        Unit: 'Count',
        Value: 1
      }
    ],
    Namespace: 'SmartCampus'
  };
  
  try {
    await cloudWatch.putMetricData(params).promise();
  } catch (error) {
    console.error('Error logging alert metric to CloudWatch:', error);
    // Don't throw error - we don't want to fail the alert if metric logging fails
  }
}