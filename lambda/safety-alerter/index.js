/**
 * staar-safety-alerter — emails the operator when crisis-detector logs
 * a critical safety event.
 *
 * Why polling instead of DDB Streams: streams need a separate
 * subscription + IAM gymnastics + are easy to mis-wire silently. A
 * 5-minute cron-driven scan over a low-volume table is bulletproof
 * and easy to reason about.
 *
 * Runs every 5 minutes via EventBridge (rate(5 minutes)). Reads
 * staar-safety-events for rows with severity='critical' AND
 * alertedAt is missing, sends SES email, marks them alertedAt=now.
 *
 * SES recipient: SAFETY_ALERT_EMAIL env (default hamid@gradeearn.com).
 * SES sender: SAFETY_ALERT_FROM env (must be SES-verified identity).
 *
 * If SES send fails: row stays unalerted, next run retries. No
 * dead-letter queue needed at this scale.
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE      = process.env.SAFETY_EVENTS_TABLE || 'staar-safety-events';
const RECIPIENT  = process.env.SAFETY_ALERT_EMAIL  || 'hamidanthro@gmail.com';
const SENDER     = process.env.SAFETY_ALERT_FROM   || 'hamidanthro@gmail.com';
const MAX_PER_RUN = 50;

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendAlert(evt) {
  const occurredIso = new Date(evt.occurredAt || Date.now()).toISOString();
  const subject = '[GradeEarn SAFETY] ' + (evt.signalType || 'unknown') + ' — ' + (evt.userId || 'anon');

  const html = [
    '<div style="font-family: -apple-system, sans-serif; color: #0f172a; max-width: 640px;">',
    '<h2 style="color: #dc2626; margin: 0 0 12px;">⚠️ Critical safety event</h2>',
    '<p style="font-size: 15px; line-height: 1.5;">The crisis detector flagged a message from a GradeEarn user and bypassed the LLM. Review below.</p>',
    '<table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">User</td><td style="padding: 6px 10px;">' + escHtml(evt.userId) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Signal type</td><td style="padding: 6px 10px;">' + escHtml(evt.signalType) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Severity</td><td style="padding: 6px 10px; color: #dc2626; font-weight: 600;">' + escHtml(evt.severity) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Source</td><td style="padding: 6px 10px;">' + escHtml(evt.source) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Action taken</td><td style="padding: 6px 10px;">' + escHtml(evt.action) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">When</td><td style="padding: 6px 10px;">' + occurredIso + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Excerpt</td><td style="padding: 6px 10px; font-family: monospace; background: #fef2f2;">' + escHtml(evt.excerpt) + '</td></tr>',
    '<tr><td style="padding: 6px 10px; background: #f8fafc; font-weight: 600;">Event ID</td><td style="padding: 6px 10px; font-family: monospace; color: #64748b;">' + escHtml(evt.eventId) + '</td></tr>',
    '</table>',
    '<p style="font-size: 13px; color: #64748b; line-height: 1.5;">The fixed safety reply (referencing 988) was already sent to the user. This email is for operator awareness and compliance audit.</p>',
    '<p style="font-size: 13px; color: #64748b;">Recommended actions:<br>',
    '• Review the full chat context in the kid\'s account if needed<br>',
    '• Consider parent outreach if the user is under 13 and the signal is self_harm or abuse<br>',
    '• Confirm the safety reply was delivered (CloudWatch logs of staar-tutor)',
    '</p>',
    '</div>'
  ].join('');

  const text = [
    'GradeEarn safety event — ' + (evt.signalType || 'unknown'),
    '',
    'User: ' + evt.userId,
    'Signal: ' + evt.signalType + ' (severity: ' + evt.severity + ')',
    'Source: ' + evt.source + ' / Action: ' + evt.action,
    'When: ' + occurredIso,
    'Excerpt: ' + evt.excerpt,
    'Event ID: ' + evt.eventId,
    '',
    'The fixed safety reply (referencing 988) was already sent. This is for operator awareness.'
  ].join('\n');

  await ses.send(new SendEmailCommand({
    Source: SENDER,
    Destination: { ToAddresses: [RECIPIENT] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        Text: { Data: text, Charset: 'UTF-8' }
      }
    }
  }));
}

exports.handler = async (event) => {
  // Find critical events not yet alerted
  const r = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'severity = :s AND attribute_not_exists(alertedAt)',
    ExpressionAttributeValues: { ':s': 'critical' },
    Limit: MAX_PER_RUN
  }));

  const events = r.Items || [];
  if (events.length === 0) {
    return { statusCode: 200, body: 'no pending alerts' };
  }

  let sent = 0;
  let failed = 0;

  for (const evt of events) {
    try {
      await sendAlert(evt);
      // Mark as alerted so we don't double-send
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { eventId: evt.eventId },
        UpdateExpression: 'SET alertedAt = :t',
        ExpressionAttributeValues: { ':t': Date.now() }
      }));
      sent++;
    } catch (err) {
      console.error('[alert] failed for', evt.eventId, ':', err.message);
      failed++;
    }
  }

  console.log('[alert] summary', JSON.stringify({ sent, failed, totalPending: events.length }));
  return { statusCode: 200, body: JSON.stringify({ sent, failed }) };
};
