/**
 * GradeEarn — Quality Patrol Lambda (I3)
 *
 * Runs daily at 4am ET. Inspects the active content pool and:
 *  - retires questions with reportedCount >= 3
 *  - retires questions with answered>=30 and accuracy<15% (probably wrong key)
 *  - demotes (qualityScore-0.2) questions answered>=30 with accuracy>98% (too easy)
 *  - flags questions with 1-2 reports for human review
 *  - promotes well-calibrated questions (40-90% accuracy, 0 reports) toward 0.95
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const POOL_TABLE = 'staar-content-pool';

const MIN_SERVED_FOR_JUDGMENT = 30;
const ACCURACY_TOO_LOW = 0.15;
const ACCURACY_TOO_HIGH = 0.98;
const REPORT_THRESHOLD_RETIRE = 3;

exports.handler = async () => {
  const startedAt = Date.now();
  console.log('[quality-patrol] starting daily sweep');

  let scanned = 0, retired = 0, demoted = 0, promoted = 0, flagged = 0;
  let lastEvaluatedKey;

  do {
    const params = {
      TableName: POOL_TABLE,
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active' },
      Limit: 200
    };
    if (lastEvaluatedKey) params.ExclusiveStartKey = lastEvaluatedKey;

    const result = await ddb.send(new ScanCommand(params));

    for (const item of (result.Items || [])) {
      scanned++;
      const correct = item.timesCorrect || 0;
      const incorrect = item.timesIncorrect || 0;
      const answered = correct + incorrect;
      const reports = item.reportedCount || 0;
      const accuracy = answered > 0 ? correct / answered : null;

      let action = null;
      let newQuality = item.qualityScore || 0.5;
      let newStatus = item.status;
      let newReview = item.reviewStatus;

      if (reports >= REPORT_THRESHOLD_RETIRE) {
        action = 'retired-reports';
        newStatus = 'retired';
        newReview = 'auto-retired-reports';
      } else if (answered >= MIN_SERVED_FOR_JUDGMENT && accuracy != null && accuracy < ACCURACY_TOO_LOW) {
        action = 'retired-low-accuracy';
        newStatus = 'retired';
        newReview = 'auto-retired-low-accuracy';
      } else if (answered >= MIN_SERVED_FOR_JUDGMENT && accuracy != null && accuracy > ACCURACY_TOO_HIGH) {
        action = 'demoted-too-easy';
        newQuality = Math.max(0.2, newQuality - 0.2);
      } else if (reports > 0 && reports < REPORT_THRESHOLD_RETIRE) {
        action = 'flagged';
        newReview = 'flagged-user-reports';
      } else if (answered >= MIN_SERVED_FOR_JUDGMENT && accuracy != null && accuracy >= 0.4 && accuracy <= 0.9 && reports === 0) {
        const distFromSweet = Math.abs(accuracy - 0.70);
        newQuality = Math.max(0.6, 0.95 - distFromSweet);
        action = 'promoted';
      }

      if (action) {
        await ddb.send(new UpdateCommand({
          TableName: POOL_TABLE,
          Key: { poolKey: item.poolKey, contentId: item.contentId },
          UpdateExpression: 'SET qualityScore = :q, #status = :s, reviewStatus = :r',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':q': newQuality, ':s': newStatus, ':r': newReview || 'unreviewed' }
        }));
        if (action.startsWith('retired')) retired++;
        else if (action === 'demoted-too-easy') demoted++;
        else if (action === 'promoted') promoted++;
        else if (action === 'flagged') flagged++;
      }
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const elapsedMs = Date.now() - startedAt;
  const summary = { scanned, retired, demoted, promoted, flagged, elapsedMs };
  console.log('PATROL_SUMMARY', JSON.stringify(summary));
  return summary;
};
