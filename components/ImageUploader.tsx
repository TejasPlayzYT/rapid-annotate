
import React, { useCallback, useState } from 'react';
import type { UploadedImage } from '../types';

interface ImageUploaderProps {
  onImagesUploaded: (images: UploadedImage[]) => void;
  disabled?: boolean;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImagesUploaded, disabled = false }) => {
  const [dragOver, setDragOver] = useState(false);
  const internalMaxFiles = 1000; // Effectively "unlimited" for practical purposes, not strictly enforced for selection

  const handleFileProcessing = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Filter for image types, no strict limit on selection count here
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) return;

    const uploadedImagesPromises = imageFiles.map(file => {
      return new Promise<UploadedImage>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const img = new Image();
          img.onload = () => {
            resolve({
              id: crypto.randomUUID(),
              file,
              dataUrl,
              name: file.name,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
            });
          };
          img.onerror = reject;
          img.src = dataUrl;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    try {
      const newImages = await Promise.all(uploadedImagesPromises);
      onImagesUploaded(newImages);
    } catch (error) {
      console.error("Error processing images:", error);
      // Handle image loading error (e.g., show an alert through a callback or context)
    }
  }, [onImagesUploaded]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (disabled) return;
    handleFileProcessing(event.dataTransfer.files);
  }, [handleFileProcessing, disabled]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setDragOver(false);
  }, [disabled]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    handleFileProcessing(event.target.files);
    event.target.value = ''; // Reset input to allow re-uploading the same file
  };

  return (
    <div className="w-full">
      <label
        htmlFor="image-upload"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center w-full h-48 px-4 
          border-2 border-dashed rounded-lg cursor-pointer
          transition-colors duration-200 ease-in-out
          ${disabled ? 'bg-gray-700 border-gray-600 cursor-not-allowed' : 
            dragOver ? 'bg-gray-700 border-sky-500' : 'bg-gray-800 border-gray-600 hover:border-gray-500 hover:bg-gray-750'
          }
        `}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
          <svg className={`w-10 h-10 mb-3 ${disabled ? 'text-gray-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
          </svg>
          <p className={`mb-2 text-sm ${disabled ? 'text-gray-500' : 'text-gray-400'}`}>
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
          <p className={`text-xs ${disabled ? 'text-gray-600' : 'text-gray-500'}`}>
            SVG, PNG, JPG, GIF, WEBP (Batch processing for multiple files)
          </p>
        </div>
        <input 
          id="image-upload" 
          type="file" 
          className="hidden" 
          multiple 
          accept="image/*" 
          onChange={handleFileChange} 
          disabled={disabled}
        />
      </label>
    </div>
  );
};

export default ImageUploader;
