import type { Aggregate, MeterProof } from './domain.js';
export type ReplayPeriod = Omit<Awaited<ReturnType<MeterProof['view']>>, 'aggregate'> & { aggregate: Aggregate | null };
export interface ReplayRequest { method: 'GET' | 'POST'; path: string; body: Record<string, unknown> | null; status: number; response: Record<string, any>; at: string }
export interface ReplayCheck { label: string; actual: unknown; expected: unknown; passed: boolean }
export interface ReplayStep {
  id: 'accept' | 'close' | 'late' | 'retry' | 'adjust' | 'verify';
  title: string; summary: string; view_basis: 'reconstructed' | 'recorded_period';
  period: ReplayPeriod; requests: ReplayRequest[]; checks: ReplayCheck[];
}
export interface RecordedReplay {
  schema_version: 1; mode: 'recorded_aws_replay'; recorded_at: string;
  source_commit: '819c512'; region: 'us-east-1'; notice: string; steps: ReplayStep[];
}
