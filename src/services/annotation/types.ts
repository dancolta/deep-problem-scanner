export type AnnotationSeverity = 'critical' | 'warning' | 'info';

export interface AnnotationCoord {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  severity: AnnotationSeverity;
  description: string;
  conversionImpact?: string; // Stat showing business impact (e.g., "Up to 50% bounce increase")
  inventoryRef?: string; // Reference to visual inventory item for traceability
}

export interface AnnotationResult {
  annotations: AnnotationCoord[];
  rawAnalysis: string;
  problemCount: number;
}

export interface AnnotationOptions {
  maxAnnotations: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

export const DEFAULT_ANNOTATION_OPTIONS: AnnotationOptions = {
  maxAnnotations: 4,
  screenshotWidth: 1920,
  screenshotHeight: 1080,
};

export interface AnnotatedImage {
  buffer: Buffer;
  emailBuffer: Buffer;
  filename: string;
  sizeKB: number;
  format: string;
  annotationCount: number;
  annotationLabels: string[];
  width: number;
  height: number;
}
