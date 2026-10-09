/**
 * Business metrics (ADR-0009). Attribute values come from closed sets: anything else is recorded as "other", so a
 * caller can never put a name, email, file name or id into a metric (PRODUCT_SPEC §14). No-ops until startTelemetry
 * has registered a meter provider.
 */
import { metrics, type Meter } from "@opentelemetry/api";

export const METRIC_NAMES = {
  operationsProcessed: "kr.operations.processed",
  queueDepth: "kr.operations.queue_depth",
  filesScanned: "kr.files.scanned",
  signins: "kr.auth.signins",
  stampReading: "kr.ai.stamp_reading",
  backupRuns: "kr.backup.runs",
} as const;

export const OPERATION_TYPES = ["conditions.extract", "conformance.read", "email.parse", "file.scan"] as const;
export const OPERATION_STATUSES = ["succeeded", "failed"] as const;
export const SCAN_RESULTS = ["clean", "infected", "error"] as const;
export const SIGNIN_RESULTS = ["success", "failure"] as const;
export const STAMP_READING_RESULTS = ["read", "disabled", "refused", "timeout", "unparseable", "error"] as const;
export const BACKUP_RESULTS = ["success", "failure"] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type ScanResult = (typeof SCAN_RESULTS)[number];
export type SigninResult = (typeof SIGNIN_RESULTS)[number];
export type StampReadingResult = (typeof STAMP_READING_RESULTS)[number];
export type BackupResult = (typeof BACKUP_RESULTS)[number];

export const OTHER = "other";

function closed<const T extends readonly string[]>(allowed: T, value: string): T[number] | typeof OTHER {
  return allowed.includes(value) ? value : OTHER;
}

export function getMeter(): Meter {
  return metrics.getMeter("kr");
}

export interface KrMetrics {
  recordOperation(op: { type: OperationType; status: OperationStatus }): void;
  /**
   * Registers the queued-operations reader behind the kr.operations.queue_depth gauge; it is called once per
   * collection. Returns a function that unregisters it.
   */
  observeQueueDepth(read: () => number | Promise<number>): () => void;
  recordFileScan(result: ScanResult): void;
  recordSignin(result: SigninResult): void;
  recordStampReading(result: StampReadingResult): void;
  recordBackupRun(result: BackupResult): void;
}

export function createMetrics(meter: Meter = getMeter()): KrMetrics {
  const operations = meter.createCounter(METRIC_NAMES.operationsProcessed, {
    description: "Operations finished by the worker",
    unit: "{operation}",
  });
  const queueDepth = meter.createObservableGauge(METRIC_NAMES.queueDepth, {
    description: "Operations waiting in the queue",
    unit: "{operation}",
  });
  const scans = meter.createCounter(METRIC_NAMES.filesScanned, {
    description: "Uploaded files scanned",
    unit: "{file}",
  });
  const signins = meter.createCounter(METRIC_NAMES.signins, { description: "Sign-in attempts", unit: "{attempt}" });
  const stamps = meter.createCounter(METRIC_NAMES.stampReading, {
    description: "AI stamp reading attempts",
    unit: "{reading}",
  });
  const backups = meter.createCounter(METRIC_NAMES.backupRuns, { description: "Backup runs", unit: "{run}" });
  return {
    recordOperation: ({ type, status }) => {
      operations.add(1, { type: closed(OPERATION_TYPES, type), status: closed(OPERATION_STATUSES, status) });
    },
    observeQueueDepth: (read) => {
      const callback = async (result: { observe(value: number): void }) => {
        const depth = await read();
        if (Number.isFinite(depth) && depth >= 0) result.observe(depth);
      };
      queueDepth.addCallback(callback);
      return () => {
        queueDepth.removeCallback(callback);
      };
    },
    recordFileScan: (result) => {
      scans.add(1, { result: closed(SCAN_RESULTS, result) });
    },
    recordSignin: (result) => {
      signins.add(1, { result: closed(SIGNIN_RESULTS, result) });
    },
    recordStampReading: (result) => {
      stamps.add(1, { result: closed(STAMP_READING_RESULTS, result) });
    },
    recordBackupRun: (result) => {
      backups.add(1, { result: closed(BACKUP_RESULTS, result) });
    },
  };
}
