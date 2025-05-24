export interface UploadedImage {
  id: string;
  file: File;
  dataUrl: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
}

export type AnnotationSource = 'gemini' | 'human-added' | 'human-edited' | 'gemini-assisted';
export type AnnotationMode = 'automatic' | 'assistive' | null;


export interface BoundingBox {
  id: string; // Unique identifier for the box
  label: string;
  x_min: number; // Normalized (0-1)
  y_min: number; // Normalized (0-1)
  width: number; // Normalized (0-1)
  height: number; // Normalized (0-1)
  color?: string; // Optional: for display
  source: AnnotationSource;
}

export interface ProcessedImageResult {
  imageId: string; // Corresponds to UploadedImage.id
  originalFileName: string;
  originalWidth: number;
  originalHeight: number;
  boxes: BoundingBox[];
}

// For Gemini API request
export interface ImageGenerativePart {
  inlineData: {
    mimeType: string;
    data: string; // base64 encoded
  };
}

// For COCO export
export interface CocoInfo {
  description: string;
  version: string;
  year: number;
  contributor: string;
  date_created: string;
}

export interface CocoLicense {
  id: number;
  name: string;
  url: string;
}

export interface CocoImage {
  id: number;
  width: number;
  height: number;
  file_name: string;
  license: number;
  date_captured: string;
}

export interface CocoAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  segmentation: []; // Not generating segmentations
  area: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
  iscrowd: 0;
}

export interface CocoCategory {
  id: number;
  name: string;
  supercategory: string;
}

export interface CocoFormat {
  info: CocoInfo;
  licenses: CocoLicense[];
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
}

// For YOLO export
export interface YoloLabelFile {
  fileName: string;
  content: string;
}

export interface YoloAnnotationFile {
  fileName: string;
  content: string;
}
export interface YoloYamlFile {
  fileName: string;
  content: string;
}

export interface YoloExportData {
  labelFile: YoloLabelFile;
  annotationFiles: YoloAnnotationFile[];
  yamlFile: YoloYamlFile;
}

// For Interactive Editor
export interface EditingImageState {
  image: UploadedImage;
  annotations: BoundingBox[];
}
