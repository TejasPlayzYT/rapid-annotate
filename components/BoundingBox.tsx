
import React from 'react';
import type { BoundingBox as BoundingBoxType } from '../types';

interface BoundingBoxProps {
  box: BoundingBoxType;
  imageWidth: number; // Natural pixel width of the original image
  imageHeight: number; // Natural pixel height of the original image
  containerWidth: number; // Actual width of the container rendering the image (for scaling display)
  containerHeight: number; // Actual height of the container rendering the image (for scaling display)
}

const BoundingBox: React.FC<BoundingBoxProps> = ({ box, imageWidth, imageHeight, containerWidth, containerHeight }) => {
  const displayColor = box.color || '#FF0000'; // Fallback color

  // Calculate scale factor for display. Assumes image is scaled maintaining aspect ratio to fit container.
  // We need to determine if scaling is limited by width or height.
  const imageAspectRatio = imageWidth / imageHeight;
  const containerAspectRatio = containerWidth / containerHeight;

  let displayScaleFactor;
  if (imageAspectRatio > containerAspectRatio) {
    // Image is wider than container, so width is the limiting factor
    displayScaleFactor = containerWidth / imageWidth;
  } else {
    // Image is taller than container (or same aspect ratio), so height is the limiting factor
    displayScaleFactor = containerHeight / imageHeight;
  }
  
  // Calculate the actual displayed size of the image within the container
  const displayedImageWidth = imageWidth * displayScaleFactor;
  const displayedImageHeight = imageHeight * displayScaleFactor;

  // Calculate offsets if the image is centered within the container
  const offsetX = (containerWidth - displayedImageWidth) / 2;
  const offsetY = (containerHeight - displayedImageHeight) / 2;

  const x = box.x_min * displayedImageWidth + offsetX;
  const y = box.y_min * displayedImageHeight + offsetY;
  const w = box.width * displayedImageWidth;
  const h = box.height * displayedImageHeight;

  const textX = x + 4; 
  const textY = y + 16; // Adjusted for typical font size. Could be dynamic.

  // Ensure text is visible if box is too small
  const labelText = w < 30 || h < 20 ? '' : box.label; // Hide label if box is tiny

  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        stroke={displayColor}
        fill="transparent"
        strokeWidth="2"
      />
      {labelText && (
        <text
          x={textX}
          y={textY}
          fill={displayColor}
          fontSize="12px"
          fontWeight="bold"
          // Style for better text visibility against varied backgrounds
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: '2.5px', strokeLinecap: 'butt', strokeLinejoin: 'miter' }}
        >
          {labelText}
        </text>
      )}
    </>
  );
};

export default BoundingBox;
    