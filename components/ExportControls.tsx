
import React from 'react';
import JSZip from 'jszip';
import type { ProcessedImageResult, UploadedImage } from '../types';
import { convertToYOLO, convertToCOCO } from '../utils/annotationFormatter';
import { TRAIN_BAT_SCRIPT_TEMPLATE, TRAIN_PS1_SCRIPT_TEMPLATE, TRAIN_SH_SCRIPT_TEMPLATE } from '../constants';


interface ExportControlsProps {
  processedResults: ProcessedImageResult[];
  uploadedImages: UploadedImage[]; 
  disabled: boolean;
}

const ExportControls: React.FC<ExportControlsProps> = ({ processedResults, uploadedImages, disabled }) => {
  
  const downloadFile = (filename: string, content: string | Blob, mimeType: string) => {
    const blob = (typeof content === 'string') ? new Blob([content], { type: mimeType }) : content;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const handleExportYOLOAnnotations = () => {
    if (processedResults.length === 0) return;
    const yoloData = convertToYOLO(processedResults);
    
    downloadFile(yoloData.labelFile.fileName, yoloData.labelFile.content, 'text/plain;charset=utf-8');

    yoloData.annotationFiles.forEach(fileData => {
      if (fileData.content.length > 0) {
        downloadFile(fileData.fileName, fileData.content, 'text/plain;charset=utf-8');
      }
    });
    // Optionally download yaml separately for annotations only if desired, though it's more for packages.
    // downloadFile(yoloData.yamlFile.fileName, yoloData.yamlFile.content, 'application/x-yaml;charset=utf-8');
  };

  const handleExportCOCOAnnotation = () => {
    if (processedResults.length === 0) return;
    const cocoData = convertToCOCO(processedResults);
    if (!cocoData || cocoData.annotations.length === 0) { 
        alert("No annotations to export for COCO format.");
        return;
    }
    const cocoJsonString = JSON.stringify(cocoData, null, 2);
    downloadFile('annotations_coco.json', cocoJsonString, 'application/json;charset=utf-8');
  };

  const handleExportYOLOTrainingPackage = async () => {
    if (processedResults.length === 0 || uploadedImages.length === 0) return;
    const zip = new JSZip();
    const yoloData = convertToYOLO(processedResults);

    // Add obj.names (or classes.txt)
    zip.file(yoloData.labelFile.fileName, yoloData.labelFile.content);
    // Add dataset.yaml
    zip.file(yoloData.yamlFile.fileName, yoloData.yamlFile.content);

    // Add training scripts
    zip.file("train.bat", TRAIN_BAT_SCRIPT_TEMPLATE);
    zip.file("train.ps1", TRAIN_PS1_SCRIPT_TEMPLATE);
    zip.file("train.sh", TRAIN_SH_SCRIPT_TEMPLATE);


    const imagesFolder = zip.folder("images");
    const labelsFolder = zip.folder("labels");

    if (!imagesFolder || !labelsFolder) {
        alert("Failed to create folders in ZIP.");
        return;
    }
    
    // Create a map of uploaded images by ID for quick lookup
    const imageMap = new Map(uploadedImages.map(img => [img.id, img]));

    for (const result of processedResults) {
        const uploadedImage = imageMap.get(result.imageId);
        if (!uploadedImage) continue;

        // Add image file (use original file name)
        imagesFolder.file(uploadedImage.name, uploadedImage.file);

        // Add corresponding annotation file
        const baseFileName = result.originalFileName.substring(0, result.originalFileName.lastIndexOf('.')) || result.originalFileName;
        const annotationFile = yoloData.annotationFiles.find(af => af.fileName === `${baseFileName}.txt`);

        if (annotationFile && annotationFile.content.length > 0) {
            labelsFolder.file(annotationFile.fileName, annotationFile.content);
        } else {
            // Create empty txt file if no annotations for this image
            const targetFileName = annotationFile ? annotationFile.fileName : `${baseFileName}.txt`;
            labelsFolder.file(targetFileName, "");
        }
    }
    
    try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadFile("yolo_training_package.zip", zipBlob, "application/zip");
    } catch (e) {
        console.error("Error generating YOLO ZIP:", e);
        alert("Error generating YOLO training package.");
    }
  };

  const handleExportCOCOTrainingPackage = async () => {
    if (processedResults.length === 0 || uploadedImages.length === 0) return;
    const zip = new JSZip();
    const cocoData = convertToCOCO(processedResults);

    if (!cocoData || cocoData.annotations.length === 0) {
        alert("No annotations to export for COCO training package.");
        return;
    }

    // Add COCO json to an 'annotations' folder
    const annotationsFolder = zip.folder("annotations");
    if (!annotationsFolder) {
         alert("Failed to create annotations folder in ZIP.");
        return;
    }
    annotationsFolder.file("instances_annotations.json", JSON.stringify(cocoData, null, 2));
    
    const imagesFolder = zip.folder("images");
     if (!imagesFolder) {
        alert("Failed to create images folder in ZIP.");
        return;
    }

    // Create a map of uploaded images by ID for quick lookup
    const imageMap = new Map(uploadedImages.map(img => [img.id, img]));

    // Include only images that are part of the cocoData.images (i.e., have been processed)
    for (const cocoImage of cocoData.images) {
        // Find the original uploaded image file. cocoImage.file_name is the original name.
        const originalUploadedImage = uploadedImages.find(img => img.name === cocoImage.file_name && imageMap.has(img.id));
         if (originalUploadedImage) {
            imagesFolder.file(originalUploadedImage.name, originalUploadedImage.file);
        }
    }

    try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadFile("coco_training_package.zip", zipBlob, "application/zip");
    } catch (e) {
        console.error("Error generating COCO ZIP:", e);
        alert("Error generating COCO training package.");
    }
  };


  const commonButtonClasses = "px-4 py-2.5 rounded-lg font-semibold transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-opacity-50 text-sm";
  const enabledButtonClasses = "bg-sky-500 hover:bg-sky-600 text-white focus:ring-sky-400";
  const disabledButtonClasses = "bg-gray-600 text-gray-400 cursor-not-allowed";
  
  const noAnnotationsFound = processedResults.every(pr => pr.boxes.length === 0);
  const isExportDisabled = disabled || processedResults.length === 0 || noAnnotationsFound;

  return (
    <div className="mt-6 p-6 bg-gray-800 rounded-lg shadow-xl">
      <h3 className="text-xl font-semibold text-gray-100 mb-5">Export Options</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
            <h4 className="text-md font-medium text-gray-300 mb-2">Annotations Only:</h4>
            <div className="flex flex-col space-y-3">
                <button
                  onClick={handleExportYOLOAnnotations}
                  disabled={isExportDisabled}
                  className={`${commonButtonClasses} w-full ${isExportDisabled ? disabledButtonClasses : enabledButtonClasses}`}
                  aria-label="Export YOLO annotations (obj.names + .txt files)"
                >
                  YOLO (.txt + obj.names)
                </button>
                <button
                  onClick={handleExportCOCOAnnotation}
                  disabled={isExportDisabled}
                  className={`${commonButtonClasses} w-full ${isExportDisabled ? disabledButtonClasses : enabledButtonClasses}`}
                   aria-label="Export COCO annotations (.json file)"
                >
                  COCO (.json)
                </button>
            </div>
        </div>
        <div>
            <h4 className="text-md font-medium text-gray-300 mb-2">Training Packages (ZIP):</h4>
            <div className="flex flex-col space-y-3">
                <button
                  onClick={handleExportYOLOTrainingPackage}
                  disabled={isExportDisabled || uploadedImages.length === 0}
                  className={`${commonButtonClasses} w-full ${isExportDisabled || uploadedImages.length === 0 ? disabledButtonClasses : enabledButtonClasses}`}
                  aria-label="Export YOLO training package (images, .txt files, obj.names, dataset.yaml, scripts)"
                >
                  YOLO Package (ZIP)
                </button>
                <button
                  onClick={handleExportCOCOTrainingPackage}
                  disabled={isExportDisabled || uploadedImages.length === 0}
                  className={`${commonButtonClasses} w-full ${isExportDisabled || uploadedImages.length === 0 ? disabledButtonClasses : enabledButtonClasses}`}
                  aria-label="Export COCO training package (images, .json file)"
                >
                  COCO Package (ZIP)
                </button>
            </div>
        </div>
      </div>
      {!isExportDisabled && (
         <p className="mt-4 text-xs text-gray-400">
           Ensure all desired images are uploaded and processed before exporting a training package.
           Packages include original images and their corresponding annotation files.
           YOLO package also includes <code className="bg-gray-700 p-1 rounded">dataset.yaml</code> and starter training scripts.
         </p>
      )}
      {isExportDisabled && processedResults.length > 0 && noAnnotationsFound && (
          <p className="mt-3 text-sm text-yellow-400">No bounding boxes were detected, so there is nothing to export.</p>
      )}
       {(isExportDisabled && uploadedImages.length === 0 && processedResults.length > 0) && (
          <p className="mt-3 text-sm text-yellow-400">Upload images to include them in training packages.</p>
      )}
    </div>
  );
};

export default ExportControls;
