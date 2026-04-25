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

## AI Tutor (`tutor.js`)

Provides interactive math help for STAAR Prep students using AWS Bedrock (Claude).

### Lambda Setup
1. Create Lambda function `staar-tutor` (Node.js 20.x)
2. Upload `tutor.js`. Bundle the dep `@aws-sdk/client-bedrock-runtime` (or use a layer / npm install in build).
3. Environment variables (all optional):
   - `BEDROCK_MODEL_ID` (default `anthropic.claude-3-5-haiku-20241022-v1:0`)
   - `BEDROCK_REGION` (default `us-east-1`)
   - `ALLOWED_ORIGIN` (e.g. `https://toolintel.ai`)
4. IAM permissions: attach a policy allowing `bedrock:InvokeModel` on the chosen model ARN.
5. Bedrock model access: in the Bedrock console under **Model access**, request access to the Anthropic Claude model you set in `BEDROCK_MODEL_ID`.
6. Timeout: 30s (LLM responses can take several seconds).

### API Gateway
- `POST /tutor` → `staar-tutor` Lambda
- `OPTIONS /tutor` → CORS preflight (Lambda handles it).

### Frontend wiring
The frontend reads `window.STAAR_TUTOR_ENDPOINT` (defaults to `https://api.toolintel.ai/tutor`).
To override, add this before `js/practice.js` loads:
```html
<script>window.STAAR_TUTOR_ENDPOINT = "https://your-api.example.com/tutor";</script>
```

