// Lambda function for waitlist signup
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = body.email?.toLowerCase().trim();

    if (!email || !email.includes('@')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid email required' })
      };
    }

    await client.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME || 'toolintel-waitlist',
      Item: {
        email: { S: email },
        signedUpAt: { S: new Date().toISOString() },
        source: { S: body.source || 'website' }
      }
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: "You're on the list!" })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Something went wrong' })
    };
  }
};
