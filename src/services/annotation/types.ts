export type AnnotationSeverity = 'critical' | 'warning' | 'info';

export interface AnnotationCoord {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  severity: AnnotationSeverity;
  description: string;
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
  maxAnnotations: 5,
  screenshotWidth: 1440,
  screenshotHeight: 900,
};

export interface AnnotatedImage {
  buffer: Buffer;
  filename: string;
  sizeKB: number;
  format: string;
  annotationCount: number;
  width: number;
  height: number;
}
