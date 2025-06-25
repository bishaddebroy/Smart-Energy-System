# Smart Campus Energy Management System

A comprehensive cloud-native application for monitoring, analyzing, and optimizing energy consumption across campus buildings, built entirely on AWS serverless architecture.

## Project Overview

The Smart Campus Energy Management System provides real-time energy monitoring and management capabilities for educational institutions. The system collects data from simulated building sensors, processes and analyzes that data in real-time, and presents actionable insights through an intuitive web dashboard.

**Key Features:**
- Real-time energy consumption monitoring across campus buildings
- Historical data analysis with trends and patterns visualization
- Automated alerting for abnormal energy usage or system events
- Comprehensive reporting capabilities with customizable date ranges
- RESTful API for integration with other campus systems

## Architecture

This application is built using a modern serverless architecture on AWS with the following components:

### AWS Services Used

1. **Compute Services**
   - AWS Lambda for serverless processing of data and API requests
   - Functions for data simulation, API handling, data archiving, and alert processing

2. **Database Services**
   - Amazon DynamoDB for high-performance, scalable NoSQL storage of real-time data
   - Time-to-Live (TTL) functionality for automatic data lifecycle management

3. **Storage Services**
   - Amazon S3 for static website hosting and long-term data archival
   - Automated lifecycle rules for cost-effective data storage

4. **Networking & Content Delivery**
   - Amazon CloudFront for global content delivery with low latency
   - Amazon API Gateway for secure and scalable API management

5. **Application Integration**
   - Amazon EventBridge for scheduled operations and event-driven architecture
   - Amazon SNS for reliable alert notifications via email and SMS

6. **Management & Governance**
   - Amazon CloudWatch for comprehensive monitoring and logging
   - AWS CloudFormation for Infrastructure as Code (IaC) deployment

## Project Structure

```
smart-campus-energy/
├── infrastructure/
│   └── cloudformation/
│       └── template.yaml       # CloudFormation template for IaC
├── src/
│   ├── functions/
│   │   ├── data-simulation/    # Lambda function for simulating energy data
│   │   │   └── index.js
│   │   ├── api-handler/        # Lambda function for API requests
│   │   │   └── index.js
│   │   ├── archive/            # Lambda function for archiving data
│   │   │   └── index.js
│   │   └── alert-checker/      # Lambda function for checking alerts
│   │       └── index.js
│   └── web/                    # Frontend web application
│       ├── index.html
│       ├── css/
│       │   └── styles.css
│       └── js/
│           └── app.js
├── README.md                   # Project documentation
└── deploy.sh                   # Deployment script
```

## Prerequisites

To deploy and run this application, you need:

1. An AWS account with appropriate permissions
2. AWS CLI installed and configured
3. Node.js 14+ and npm installed
4. AWS SAM CLI (optional but recommended for local testing)

## Deployment Instructions

Follow these steps to deploy the Smart Campus Energy Management System:

### 1. Clone the Repository

```bash
git clone https://github.com/bishaddebroy/Smart-Energy-System.git
cd Smart-Energy-System
```

### 2. Install Dependencies

```bash
# Install dependencies for Lambda functions
cd src/functions/data-simulation
npm install
cd ../api-handler
npm install
cd ../archive
npm install
cd ../alert-checker
npm install
cd ../../..
```

### 3. Configure the Application

Update the configuration files:

- Edit `src/web/js/app.js` to update the `CONFIG.apiEndpoint` value with your actual API Gateway URL after deployment.
- Adjust parameters in `infrastructure/cloudformation/template.yaml` if needed (environment, retention periods, etc.)

### 4. Deploy the Infrastructure

Run the deployment script:

```bash
./deploy.sh
```

Alternatively, deploy manually with the AWS CLI:

```bash
# Create S3 bucket for deployment artifacts
aws s3 mb s3://smart-campus-energy-deployment-bucket

# Package the CloudFormation template
aws cloudformation package \
  --template-file infrastructure/cloudformation/template.yaml \
  --s3-bucket smart-campus-energy-deployment-bucket \
  --output-template-file packaged.yaml

# Deploy the CloudFormation stack
aws cloudformation deploy \
  --template-file packaged.yaml \
  --stack-name smart-campus-energy \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Environment=dev RetentionDays=30
```

### 5. Upload Web Assets

After infrastructure deployment, upload the web application files to the created S3 bucket:

```bash
# Get the S3 bucket name from CloudFormation outputs
WEBSITE_BUCKET=$(aws cloudformation describe-stacks --stack-name smart-campus-energy --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" --output text)

# Upload website files
aws s3 sync src/web/ s3://$WEBSITE_BUCKET/ --acl public-read
```

### 6. Access the Application

Get the CloudFront URL from the CloudFormation outputs:

```bash
CLOUDFRONT_URL=$(aws cloudformation describe-stacks --stack-name smart-campus-energy --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" --output text)
echo "Application URL: $CLOUDFRONT_URL"
```

Visit the URL in your browser to access the Smart Campus Energy Management dashboard.

## Local Development and Testing

For local development and testing:

1. Use AWS SAM CLI to test Lambda functions locally:
   ```bash
   sam local invoke DataSimulationFunction
   ```

2. For the web interface, you can use a local HTTP server:
   ```bash
   cd src/web
   npx http-server
   ```

## AWS Well-Architected Framework Alignment

This solution aligns with the AWS Well-Architected Framework's six pillars:

1. **Operational Excellence**
   - Infrastructure as Code with CloudFormation
   - Comprehensive monitoring and logging with CloudWatch
   - Automated deployment processes

2. **Security**
   - Least privilege IAM roles
   - API Gateway authentication and authorization
   - Encryption at rest and in transit

3. **Reliability**
   - Multi-AZ deployment for high availability
   - Serverless architecture eliminates single points of failure
   - Automatic scaling with serverless services

4. **Performance Efficiency**
   - DynamoDB's millisecond-latency for real-time data
   - CloudFront for optimized content delivery
   - Efficient data lifecycle management

5. **Cost Optimization**
   - Serverless pay-per-use pricing model
   - S3 lifecycle policies for cost-effective storage
   - Resource rightsizing

6. **Sustainability**
   - Serverless computing reduces idle resource waste
   - Efficient resource utilization with event-driven architecture
   - Data-driven insights for campus energy conservation

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- AWS for providing the cloud infrastructure and services
- Dalhousie University for inspiration and use case scenarios
- All contributors to this project