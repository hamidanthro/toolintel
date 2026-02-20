# Lambda Deployment

## Reviews API

### DynamoDB Setup
Create table: `toolintel-reviews`
- Partition key: `id` (String)
- GSI: `tool-status-index` with partition key `tool` (String) and sort key `status` (String)

### Lambda Setup
1. Create Lambda function `toolintel-reviews`
2. Runtime: Node.js 20.x
3. Upload reviews.js
4. Environment variable: `ADMIN_KEY=your-secret-key`
5. Attach DynamoDB permissions

### API Gateway
Add routes to existing API:
- GET /reviews
- GET /reviews/admin
- POST /reviews
- PATCH /reviews/{id}
- DELETE /reviews/{id}

All routes → toolintel-reviews Lambda
