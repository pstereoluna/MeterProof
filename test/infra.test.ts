import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MeterProofStack } from '../infra/stack';

test('deployable stack preserves the frozen serverless scope and metering safeguards', () => {
  const stack = new MeterProofStack(new App(), 'TestMeterProof');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::DynamoDB::Table', 2);
  template.resourceCountIs('AWS::Lambda::Function', 2);
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  template.resourceCountIs('AWS::Logs::LogGroup', 2);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
  });
  for (const table of Object.values(template.findResources('AWS::DynamoDB::Table'))) {
    assert.equal(table.DeletionPolicy, 'Retain');
    assert.equal(table.UpdateReplacePolicy, 'Retain');
  }
  for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
    assert.equal(fn.Properties.Runtime, 'nodejs22.x');
    assert.ok(fn.Properties.Environment.Variables.LEDGER_TABLE);
    assert.ok(fn.Properties.Environment.Variables.STATE_TABLE);
  }
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    StartingPosition: 'TRIM_HORIZON',
    FunctionResponseTypes: ['ReportBatchItemFailures'],
    MaximumRetryAttempts: -1,
    FilterCriteria: {
      Filters: [{ Pattern: JSON.stringify({
        eventName: ['INSERT'], dynamodb: { NewImage: { entity: { S: ['EVENT'] } } },
      }) }],
    },
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
  template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    DefaultRouteSettings: { ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 },
  });
  for (const route of ['GET /', 'GET /api/health', 'GET /api/period', 'POST /api/events', 'POST /api/close', 'POST /api/adjust']) {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: route });
  }
  template.hasOutput('ApiUrl', { Value: Match.anyValue() });
  template.hasOutput('LedgerTableName', { Value: Match.anyValue() });
  template.hasOutput('StateTableName', { Value: Match.anyValue() });

  // Guard against expanding this demonstration into a larger platform.
  for (const type of ['AWS::SQS::Queue', 'AWS::Events::Rule', 'AWS::StepFunctions::StateMachine',
    'AWS::Kinesis::Stream', 'AWS::S3::Bucket', 'AWS::CloudFront::Distribution', 'AWS::Cognito::UserPool']) {
    template.resourceCountIs(type, 0);
  }
  const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
  assert.ok(policies.includes('dynamodb:ConditionCheckItem'), 'ingestion cutoff checks need explicit IAM permission');
  for (const forbidden of ['dynamodb:DeleteItem', 'dynamodb:Scan', 'dynamodb:*']) {
    assert.equal(policies.includes(forbidden), false, `${forbidden} should not be granted`);
  }
});
