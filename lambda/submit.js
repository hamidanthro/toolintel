// Lambda function for tool submission
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    
    // Validate required fields
    const required = ['productName', 'productUrl', 'category', 'pricing', 'privacyUrl', 'tosUrl', 'contactEmail', 'description'];
    for (const field of required) {
      if (!body[field]) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing required field: ${field}` })
        };
      }
    }

    const submissionId = crypto.randomUUID();

    await client.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME || 'toolintel-submissions',
      Item: {
        submissionId: { S: submissionId },
        productName: { S: body.productName },
        productUrl: { S: body.productUrl },
        category: { S: body.category },
        pricing: { S: body.pricing },
        privacyUrl: { S: body.privacyUrl },
        tosUrl: { S: body.tosUrl },
        certifications: { S: body.certifications || '' },
        contactEmail: { S: body.contactEmail.toLowerCase() },
        description: { S: body.description.substring(0, 3000) },
        willingToInterview: { BOOL: body.interview === 'yes' },
        status: { S: 'pending' },
        submittedAt: { S: new Date().toISOString() }
      }
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, submissionId })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Submission failed. Please try again.' })
    };
  }
};
