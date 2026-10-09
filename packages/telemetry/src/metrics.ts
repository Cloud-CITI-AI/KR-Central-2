/**
 * Business metrics (ADR-0009). Attribute values come from closed sets: anything else is recorded as "other", so a
 * caller can never put a name, email, file name or id into a metric (PRODUCT_SPEC §14). No-ops until startTelemetry
 * has registered a meter provider.
 */
import { metrics, type Meter, type ObservableGauge } from "@opentelemetry/api";

export const METRIC_NAMES = {
  operationsProcessed: "kr.operations.processed",
  operationsDuration: "kr.operations.duration",
  queueDepth: "kr.operations.queue_depth",
  queueAge: "kr.operations.queue_age",
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

/** Seconds from enqueue to finish; brackets the 120 s target of SLO-4. */
export const OPERATION_DURATION_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];

/** A queue reading: one number (recorded without a type) or one number per operation type. */
export type QueueReading = number | Partial<Record<OperationType, number>>;
export type QueueReader = () => QueueReading | Promise<QueueReading>;

function closed<const T extends readonly string[]>(allowed: T, value: string): T[number] | typeof OTHER {
  return allowed.includes(value) ? value : OTHER;
}

export function getMeter(): Meter {
  return metrics.getMeter("kr");
}

export interface KrMetrics {
  /** `durationSeconds` (enqueue to finish) also feeds the kr.operations.duration histogram when it is a valid number. */
  recordOperation(op: { type: OperationType; status: OperationStatus; durationSeconds?: number }): void;
  /**
   * Registers the queued-operations reader behind the kr.operations.queue_depth gauge; it is called once per
   * collection. Returns a function that unregisters it.
   */
  observeQueueDepth(read: QueueReader): () => void;
  /** Same shape for kr.operations.queue_age: the age in seconds of the oldest queued operation. */
  observeQueueAge(read: QueueReader): () => void;
  recordFileScan(result: ScanResult): void;
  recordSignin(result: SigninResult): void;
  recordStampReading(result: StampReadingResult): void;
  recordBackupRun(result: BackupResult): void;
}

const isValid = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** Registers `read` on the gauge. Readings outside a closed type collapse into "other" (combined with `combine`). */
function observeReader(
  gauge: ObservableGauge,
  read: QueueReader,
  combine: (a: number, b: number) => number,
): () => void {
  const callback = async (result: { observe(value: number, attributes?: { type: string }): void }) => {
    const reading = await read();
    if (typeof reading === "number") {
      if (isValid(reading)) result.observe(reading);
      return;
    }
    const byType = new Map<string, number>();
    for (const [type, value] of Object.entries(reading)) {
      if (!isValid(value)) continue;
      const key = closed(OPERATION_TYPES, type);
      byType.set(key, byType.has(key) ? combine(byType.get(key) ?? 0, value) : value);
    }
    for (const [type, value] of byType) result.observe(value, { type });
  };
  gauge.addCallback(callback);
  return () => {
    gauge.removeCallback(callback);
  };
}

export function createMetrics(meter: Meter = getMeter()): KrMetrics {
  const operations = meter.createCounter(METRIC_NAMES.operationsProcessed, {
    description: "Operations finished by the worker",
    unit: "{operation}",
  });
  const duration = meter.createHistogram(METRIC_NAMES.operationsDuration, {
    description: "Seconds from enqueue to finish of operations",
    unit: "s",
    advice: { explicitBucketBoundaries: OPERATION_DURATION_BUCKETS },
  });
  const queueDepth = meter.createObservableGauge(METRIC_NAMES.queueDepth, {
    description: "Operations waiting in the queue",
    unit: "{operation}",
  });
  const queueAge = meter.createObservableGauge(METRIC_NAMES.queueAge, {
    description: "Age of the oldest queued operation",
    unit: "s",
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
    recordOperation: ({ type, status, durationSeconds }) => {
      const attributes = { type: closed(OPERATION_TYPES, type), status: closed(OPERATION_STATUSES, status) };
      operations.add(1, attributes);
      if (durationSeconds !== undefined && isValid(durationSeconds)) duration.record(durationSeconds, attributes);
    },
    observeQueueDepth: (read) => observeReader(queueDepth, read, (a, b) => a + b),
    observeQueueAge: (read) => observeReader(queueAge, read, Math.max),
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
