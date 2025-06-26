# Create a CloudWatch dashboard with specific metrics
aws cloudwatch put-dashboard \
  --dashboard-name SmartCampusEnergy \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "x": 0,
        "y": 0,
        "width": 12,
        "height": 6,
        "properties": {
          "metrics": [
            [ "SmartCampus", "EnergyConsumption", "BuildingId", "academic-01" ],
            [ ".", ".", "BuildingId", "academic-02" ],
            [ ".", ".", "BuildingId", "residential-01" ],
            [ ".", ".", "BuildingId", "lab-01" ],
            [ ".", ".", "BuildingId", "admin-01" ]
          ],
          "view": "timeSeries",
          "stacked": false,
          "region": "us-east-1",
          "period": 60,
          "stat": "Maximum",
          "title": "Building Energy Consumption",
          "annotations": {
            "horizontal": [
              {
                "label": "Threshold",
                "value": 200
              }
            ]
          }
        }
      }
    ]
  }'