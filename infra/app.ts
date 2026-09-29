import { App } from 'aws-cdk-lib';
import { MeterProofStack } from './stack';

const app = new App();
// No account lookup is required for synthesis. Select a target at deployment.
new MeterProofStack(app, 'MeterProof');
