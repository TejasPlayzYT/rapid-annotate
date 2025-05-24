import React, { useRef, useEffect, useState } from 'react';
import type { UploadedImage, ProcessedImageResult, BoundingBox as BoundingBoxType } from '../types';
import BoundingBox from './BoundingBox';
import { getLabelColor } from '../utils/colorUtils';

interface AnnotatedImageDisplayProps {
  uploadedImage: UploadedImage;
  annotationResult?: ProcessedImageResult;
  onImageClick?: (image: UploadedImage, result?: ProcessedImageResult) => void; // For opening editor
  isClickable?: boolean;
}

const AnnotatedImageDisplay: React.FC<AnnotatedImageDisplayProps> = ({ 
  uploadedImage, 
  annotationResult, 
  onImageClick,
  isClickable = false 
}) => {
  const [renderSize, setRenderSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateSize = () => {
      if (imageRef.current) {
        setRenderSize({
          width: imageRef.current.offsetWidth,
          height: imageRef.current.offsetHeight,
        });
      } else if (containerRef.current) {
         setRenderSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    
    const imgElement = imageRef.current;
    if (imgElement) {
        imgElement.addEventListener('load', updateSize);
        if (imgElement.complete && imgElement.naturalWidth > 0) {
            updateSize();
        }
    }

    const resizeObserver = new ResizeObserver(() => {
        updateSize();
    });

    if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      if (imgElement) {
        imgElement.removeEventListener('load', updateSize);
      }
      resizeObserver.disconnect();
    };
  }, [uploadedImage.dataUrl]);

  const boxesToDisplay: BoundingBoxType[] = annotationResult?.boxes.map(box => ({
    ...box,
    color: getLabelColor(box.label),
  })) || [];

  const handleClick = () => {
    if (isClickable && onImageClick) {
      onImageClick(uploadedImage, annotationResult);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full aspect-[4/3] bg-gray-800 rounded-lg overflow-hidden shadow-md flex items-center justify-center ${isClickable ? 'cursor-pointer hover:ring-2 hover:ring-sky-500 transition-all' : ''}`}
      onClick={handleClick}
      onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick();}}
      tabIndex={isClickable ? 0 : -1}
      role={isClickable ? "button" : undefined}
      aria-label={isClickable ? `Edit annotations for ${uploadedImage.name}` : undefined}
    >
      <img
        ref={imageRef}
        src={uploadedImage.dataUrl}
        alt={uploadedImage.name}
        className="block max-w-full max-h-full object-contain"
      />
      {boxesToDisplay.length > 0 && renderSize.width > 0 && renderSize.height > 0 && (
        <svg
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${renderSize.width} ${renderSize.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {boxesToDisplay.map((box) => ( // Removed index from key as box.id is now unique
            <BoundingBox
              key={`${box.id}`}
              box={box}
              imageWidth={uploadedImage.naturalWidth} 
              imageHeight={uploadedImage.naturalHeight}
              containerWidth={renderSize.width} 
              containerHeight={renderSize.height}
            />
          ))}
        </svg>
      )}
      <div className="absolute bottom-0 left-0 w-full bg-black bg-opacity-60 text-white p-2 text-xs truncate">
        {uploadedImage.name} ({uploadedImage.naturalWidth}x{uploadedImage.naturalHeight}px)
        {annotationResult && ` - ${annotationResult.boxes.length} objects`}
      </div>
      {isClickable && (
        <div className="absolute top-2 right-2 bg-sky-500 text-white text-xs px-2 py-1 rounded-full opacity-80 group-hover:opacity-100 transition-opacity">
          Edit
        </div>
      )}
    </div>
  );
};

export default AnnotatedImageDisplay;