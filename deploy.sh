#!/bin/bash

# Smart Campus Energy Management System
# Deployment Script

# Exit on error
set -e

# Configuration
STACK_NAME="smart-campus-energy"
ENVIRONMENT="dev"
REGION="us-east-1"
DEPLOYMENT_BUCKET="${STACK_NAME}-deployment-${ENVIRONMENT}"
CLOUDFORMATION_TEMPLATE="infrastructure/cloudformation/template.yaml"
PACKAGED_TEMPLATE="packaged.yaml"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print banner
echo -e "${GREEN}"
echo "=================================================="
echo "  Smart Campus Energy Management System Deployment"
echo "=================================================="
echo -e "${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed. Please install it before running this script.${NC}"
    exit 1
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured. Please run 'aws configure' and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ AWS credentials valid${NC}"

# Create deployment bucket if it doesn't exist
echo "Checking deployment bucket..."
if ! aws s3 ls "s3://${DEPLOYMENT_BUCKET}" &> /dev/null; then
    echo "Creating deployment bucket: ${DEPLOYMENT_BUCKET}"
    aws s3 mb "s3://${DEPLOYMENT_BUCKET}" --region ${REGION}
    
    # Wait for bucket to be available
    echo "Waiting for bucket to be available..."
    sleep 5
else
    echo -e "${GREEN}✓ Deployment bucket exists${NC}"
fi

# Clean up existing S3 buckets if needed
echo "Checking for existing resources..."
WEBSITE_BUCKET="smart-campus-energy-website-$(aws sts get-caller-identity --query Account --output text)-${ENVIRONMENT}"
HISTORICAL_BUCKET="smart-campus-energy-data-$(aws sts get-caller-identity --query Account --output text)-${ENVIRONMENT}"

# Try to delete existing buckets (ignore errors)
echo "Attempting to clean up any existing S3 buckets..."
aws s3 rm "s3://${WEBSITE_BUCKET}" --recursive 2>/dev/null || true
aws s3 rb "s3://${WEBSITE_BUCKET}" 2>/dev/null || true
aws s3 rm "s3://${HISTORICAL_BUCKET}" --recursive 2>/dev/null || true
aws s3 rb "s3://${HISTORICAL_BUCKET}" 2>/dev/null || true

# Package Lambda functions
echo "Packaging Lambda functions..."
FUNCTIONS=("data-simulation" "api-handler" "archive" "alert-checker")

for func in "${FUNCTIONS[@]}"; do
    echo "Packaging function: ${func}"
    
    # Create a temporary directory for packaging
    TEMP_DIR=$(mktemp -d)
    
    # Copy function code to temp directory
    cp -r "src/functions/${func}/"* "${TEMP_DIR}/"
    
    # Install dependencies if package.json exists
    if [ -f "${TEMP_DIR}/package.json" ]; then
        echo "Installing dependencies for ${func}..."
        (cd "${TEMP_DIR}" && npm install --production)
    fi
    
    # Create a zip file
    ZIP_FILE="${func}.zip"
    (cd "${TEMP_DIR}" && zip -r "${ZIP_FILE}" .)
    mv "${TEMP_DIR}/${ZIP_FILE}" .
    
    # Upload to S3
    aws s3 cp "${ZIP_FILE}" "s3://${DEPLOYMENT_BUCKET}/lambda/${ZIP_FILE}" --region ${REGION}
    
    # Clean up
    rm "${ZIP_FILE}"
    rm -rf "${TEMP_DIR}"
    
    echo -e "${GREEN}✓ Function ${func} packaged and uploaded${NC}"
done

# Package CloudFormation template
echo "Packaging CloudFormation template..."
aws cloudformation package \
    --template-file ${CLOUDFORMATION_TEMPLATE} \
    --s3-bucket ${DEPLOYMENT_BUCKET} \
    --output-template-file ${PACKAGED_TEMPLATE} \
    --region ${REGION}

echo -e "${GREEN}✓ Template packaged${NC}"

# Deploy CloudFormation stack
echo "Deploying CloudFormation stack: ${STACK_NAME}"
echo -e "${YELLOW}This may take several minutes...${NC}"

aws cloudformation deploy \
    --template-file ${PACKAGED_TEMPLATE} \
    --stack-name ${STACK_NAME} \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides Environment=${ENVIRONMENT} RetentionDays=30 \
    --region ${REGION}

echo -e "${GREEN}✓ Stack deployed successfully${NC}"

# Get stack outputs
echo "Retrieving stack outputs..."
WEBSITE_BUCKET=$(aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${REGION} --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" --output text)
API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${REGION} --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)
WEBSITE_URL=$(aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${REGION} --query "Stacks[0].Outputs[?OutputKey=='WebsiteURL'].OutputValue" --output text)

# Update API endpoint in web app configuration
echo "Updating API endpoint in web application..."
sed -i.bak "s|apiEndpoint: 'https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/dev/energy'|apiEndpoint: '${API_ENDPOINT}'|g" src/web/js/app.js
rm src/web/js/app.js.bak

# Upload website files to S3
echo "Uploading website files to S3..."
aws s3 sync src/web/ "s3://${WEBSITE_BUCKET}/" --region ${REGION}

echo -e "${GREEN}✓ Website uploaded${NC}"

# Print summary
echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}Deployment Completed Successfully!${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "Website URL: ${WEBSITE_URL}"
echo -e "API Endpoint: ${API_ENDPOINT}"
echo -e "${GREEN}======================================================${NC}"