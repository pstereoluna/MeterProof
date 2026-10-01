import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** A deliberately small, single-region usage-metering demonstration. */
export class MeterProofStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, '..');
    const ledger = new dynamodb.Table(this, 'Ledger', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const state = new dynamodb.Table(this, 'State', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const environment = {
      LEDGER_TABLE: ledger.tableName,
      STATE_TABLE: state.tableName,
    };
    const apiLogs = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const meterLogs = new logs.LogGroup(this, 'MeterLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      description: 'MeterProof HTTP API and single demo screen',
      entry: path.join(projectRoot, 'src/api.ts'),
      handler: 'handler',
      projectRoot,
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      memorySize: 256,
      timeout: Duration.seconds(25),
      environment,
      logGroup: apiLogs,
      bundling: {
        target: 'node22',
        format: OutputFormat.CJS,
        bundleAwsSDK: true,
        externalModules: [],
        sourceMap: true,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir, outputDir) => [
            `mkdir -p ${shellQuote(path.join(outputDir, 'web'))}`,
            `cp ${shellQuote(path.join(inputDir, 'web/index.html'))} ${shellQuote(path.join(outputDir, 'web/index.html'))}`,
            `cp ${shellQuote(path.join(inputDir, 'web/replay.json'))} ${shellQuote(path.join(outputDir, 'web/replay.json'))}`,
          ],
        },
      },
    });
    const meterFunction = new NodejsFunction(this, 'MeterFunction', {
      description: 'Idempotent asynchronous usage projection from ledger inserts',
      entry: path.join(projectRoot, 'src/meter.ts'),
      handler: 'handler',
      projectRoot,
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment,
      logGroup: meterLogs,
      bundling: {
        target: 'node22',
        format: OutputFormat.CJS,
        bundleAwsSDK: true,
        externalModules: [],
        sourceMap: true,
      },
    });

    // Transaction permissions are evaluated for the underlying item operations.
    // Ledger puts also require attribute_not_exists in the application; IAM
    // intentionally grants neither UpdateItem nor DeleteItem on the ledger.
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem'],
      resources: [ledger.tableArn],
    }));
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'],
      resources: [state.tableArn],
    }));
    meterFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [state.tableArn],
    }));
    meterFunction.addEventSource(new DynamoEventSource(ledger, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
      reportBatchItemFailures: true,
      // Keep retrying until DynamoDB Streams retention expires (24 hours).
      retryAttempts: -1,
      filters: [lambda.FilterCriteria.filter({
        eventName: ['INSERT'],
        dynamodb: { NewImage: { entity: { S: ['EVENT'] } } },
      })],
    }));

    const api = new apigateway.HttpApi(this, 'HttpApi', {
      description: 'MeterProof frozen MVP; unauthenticated hackathon demo',
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);
    api.addRoutes({
      path: '/', methods: [apigateway.HttpMethod.GET], integration,
    });
    for (const route of ['/api/health', '/api/period', '/api/replay']) {
      api.addRoutes({ path: route, methods: [apigateway.HttpMethod.GET], integration });
    }
    for (const route of ['/api/events', '/api/close', '/api/adjust']) {
      api.addRoutes({ path: route, methods: [apigateway.HttpMethod.POST], integration });
    }
    // Protect the public demo from accidental bursts; this is not a product quota.
    const stage = api.defaultStage!.node.defaultChild as apigateway.CfnStage;
    stage.defaultRouteSettings = {
      throttlingBurstLimit: 20,
      throttlingRateLimit: 10,
    };

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'LedgerTableName', { value: ledger.tableName });
    new CfnOutput(this, 'StateTableName', { value: state.tableName });
  }
}
