import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { UploadedImage, BoundingBox as BoundingBoxType, AnnotationSource, EditingImageState } from '../types';
import { getLabelColor, resetLabelColors } from '../utils/colorUtils'; // Assuming resetLabelColors might be useful if opening editor changes overall label set for colors.
import Spinner from './Spinner';

interface InteractiveAnnotatorProps {
  editingState: EditingImageState;
  onSave: (imageId: string, updatedAnnotations: BoundingBoxType[]) => void;
  onClose: () => void;
  onGeminiAssist: (
    imageFile: File, 
    assistPrompt: string, 
    currentAnnotations: BoundingBoxType[]
  ) => Promise<BoundingBoxType[]>;
}

type InteractionMode = 'select' | 'draw' | 'resize' | 'move';
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

// Fix: Define InteractionState to include temporary properties for mouse interactions
interface InteractionState extends Partial<BoundingBoxType> {
  startX?: number;
  startY?: number;
  boxInitialX?: number;
  boxInitialY?: number;
}

const InteractiveAnnotator: React.FC<InteractiveAnnotatorProps> = ({
  editingState,
  onSave,
  onClose,
  onGeminiAssist,
}) => {
  const { image, annotations: initialAnnotations } = editingState;
  const [boxes, setBoxes] = useState<BoundingBoxType[]>(() => 
    initialAnnotations.map(b => ({...b, color: getLabelColor(b.label) }))
  );
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select');
  // Fix: Use InteractionState for currentDrawingBox
  const [currentDrawingBox, setCurrentDrawingBox] = useState<InteractionState | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  
  const [assistPrompt, setAssistPrompt] = useState<string>('');
  const [isAssisting, setIsAssisting] = useState<boolean>(false);
  const [assistError, setAssistError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageRenderSize, setImageRenderSize] = useState<{ width: number, height: number, offsetX: number, offsetY: number }>({ width: 0, height: 0, offsetX:0, offsetY:0 });

  // Calculate image render size and offsets for coordinate conversion
  useEffect(() => {
    const updateRenderSize = () => {
      if (imageRef.current && svgRef.current) {
        const img = imageRef.current;
        const svg = svgRef.current;
        const svgRect = svg.getBoundingClientRect();
        
        const imgAspectRatio = img.naturalWidth / img.naturalHeight;
        const svgAspectRatio = svgRect.width / svgRect.height;

        let renderedWidth, renderedHeight;
        if (imgAspectRatio > svgAspectRatio) { // Image wider than container, width is limiting
            renderedWidth = svgRect.width;
            renderedHeight = svgRect.width / imgAspectRatio;
        } else { // Image taller, height is limiting
            renderedHeight = svgRect.height;
            renderedWidth = svgRect.height * imgAspectRatio;
        }
        
        const offsetX = (svgRect.width - renderedWidth) / 2;
        const offsetY = (svgRect.height - renderedHeight) / 2;

        setImageRenderSize({ width: renderedWidth, height: renderedHeight, offsetX, offsetY });
      }
    };

    const imgElement = imageRef.current;
    if (imgElement) {
      imgElement.addEventListener('load', updateRenderSize);
      if (imgElement.complete) updateRenderSize(); // If already loaded
      
      const resizeObserver = new ResizeObserver(updateRenderSize);
      if (svgRef.current) resizeObserver.observe(svgRef.current); // Observe SVG container

      return () => {
        imgElement.removeEventListener('load', updateRenderSize);
        resizeObserver.disconnect();
      };
    }
  }, [image.dataUrl]);


  const getNormalizedCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current || imageRenderSize.width === 0) return null;
    const svgRect = svgRef.current.getBoundingClientRect();
    const x = (clientX - svgRect.left - imageRenderSize.offsetX) / imageRenderSize.width;
    const y = (clientY - svgRect.top - imageRenderSize.offsetY) / imageRenderSize.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };
  
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const coords = getNormalizedCoords(e.clientX, e.clientY);
    if (!coords) return;

    if (interactionMode === 'draw') {
      setCurrentDrawingBox({ x_min: coords.x, y_min: coords.y, width: 0, height: 0 });
    } else if (interactionMode === 'select' || interactionMode === 'move' || interactionMode === 'resize') {
        // Check if clicking on a resize handle of the selected box
        const selectedBox = boxes.find(b => b.id === selectedBoxId);
        if (selectedBox) {
            const handleSize = 10 / Math.min(imageRenderSize.width, imageRenderSize.height); // Normalized handle size approx
            // Logic to determine if a resize handle was clicked (simplified)
            // Real implementation would check specific handle areas more precisely
             if (
                Math.abs(coords.x - (selectedBox.x_min + selectedBox.width)) < handleSize && Math.abs(coords.y - (selectedBox.y_min + selectedBox.height)) < handleSize
            ) { setInteractionMode('resize'); setResizeHandle('se'); return; }
            // Add more handle checks (nw, ne, sw, n, s, e, w)
        }


      // Check if clicking inside any box to select or start moving
      let clickedOnBox = false;
      for (let i = boxes.length - 1; i >= 0; i--) { // Iterate backwards to select topmost box
        const box = boxes[i];
        if (coords.x >= box.x_min && coords.x <= box.x_min + box.width &&
            coords.y >= box.y_min && coords.y <= box.y_min + box.height) {
          setSelectedBoxId(box.id);
          setInteractionMode('move'); // Tentatively set to move
          // Fix: Ensure startX, startY, boxInitialX, boxInitialY are part of InteractionState
          setCurrentDrawingBox({startX: coords.x, startY: coords.y, boxInitialX: box.x_min, boxInitialY: box.y_min}); // Store start pos for move
          clickedOnBox = true;
          break;
        }
      }
      if (!clickedOnBox) {
          setSelectedBoxId(null); // Clicked outside any box
          if (interactionMode === 'move' || interactionMode === 'resize') setInteractionMode('select'); // Revert to select mode if not on box
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const coords = getNormalizedCoords(e.clientX, e.clientY);
    if (!coords || !currentDrawingBox) return;

    if (interactionMode === 'draw' && currentDrawingBox.x_min !== undefined && currentDrawingBox.y_min !== undefined) {
      const newWidth = Math.abs(coords.x - currentDrawingBox.x_min);
      const newHeight = Math.abs(coords.y - currentDrawingBox.y_min);
      setCurrentDrawingBox({
        ...currentDrawingBox,
        width: newWidth,
        height: newHeight,
        x_min: Math.min(coords.x, currentDrawingBox.x_min as number),
        y_min: Math.min(coords.y, currentDrawingBox.y_min as number),
      });
    } else if (interactionMode === 'move' && selectedBoxId && currentDrawingBox.startX !== undefined) {
      const selectedBox = boxes.find(b => b.id === selectedBoxId);
      // Fix: Ensure boxInitialX and boxInitialY are checked on InteractionState
      if (!selectedBox || currentDrawingBox.boxInitialX === undefined || currentDrawingBox.boxInitialY === undefined) return;
      
      // Fix: Ensure startX and startY are accessed from InteractionState
      const dx = coords.x - currentDrawingBox.startX;
      const dy = coords.y - currentDrawingBox.startY;
      // Fix: Ensure boxInitialX and boxInitialY are accessed from InteractionState
      let newXMin = currentDrawingBox.boxInitialX + dx;
      let newYMin = currentDrawingBox.boxInitialY + dy;

      // Clamp to image boundaries
      newXMin = Math.max(0, Math.min(newXMin, 1 - selectedBox.width));
      newYMin = Math.max(0, Math.min(newYMin, 1 - selectedBox.height));

      setBoxes(prev => prev.map(b => b.id === selectedBoxId ? { ...b, x_min: newXMin, y_min: newYMin, source: 'human-edited' } : b));
    } else if (interactionMode === 'resize' && selectedBoxId && resizeHandle) {
        const selectedBox = boxes.find(b => b.id === selectedBoxId);
        if(!selectedBox) return;

        let { x_min, y_min, width, height } = selectedBox;
        // Simplified resize - SE corner for demo
        if (resizeHandle === 'se') {
            width = Math.max(0.01, coords.x - x_min); // Min width/height
            height = Math.max(0.01, coords.y - y_min);
        }
        // Add logic for other handles (nw, ne, sw, n, s, e, w)
        // Ensure x_min, y_min are updated if resizing from nw, n, w handles

        // Clamp width/height
        if (x_min + width > 1) width = 1 - x_min;
        if (y_min + height > 1) height = 1 - y_min;

        setBoxes(prev => prev.map(b => b.id === selectedBoxId ? { ...b, x_min, y_min, width, height, source: 'human-edited' } : b));
    }
  };

  const handleMouseUp = () => {
    if (interactionMode === 'draw' && currentDrawingBox && currentDrawingBox.width && currentDrawingBox.height) {
      const newLabel = prompt("Enter label for the new box:", "new object");
      if (newLabel) {
        const newBox: BoundingBoxType = {
          id: crypto.randomUUID(),
          label: newLabel,
          x_min: currentDrawingBox.x_min as number,
          y_min: currentDrawingBox.y_min as number,
          width: currentDrawingBox.width,
          height: currentDrawingBox.height,
          source: 'human-added',
          color: getLabelColor(newLabel),
        };
        setBoxes(prev => [...prev, newBox]);
        setSelectedBoxId(newBox.id);
      }
    }
    if(interactionMode === 'move' || interactionMode === 'resize') {
        setInteractionMode('select'); // Revert to select after move/resize
    }
    setCurrentDrawingBox(null);
    setResizeHandle(null);
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBoxId) return;
    const newLabel = e.target.value;
    setBoxes(prev => prev.map(b => b.id === selectedBoxId ? { ...b, label: newLabel, source: 'human-edited', color: getLabelColor(newLabel) } : b));
  };

  const handleDeleteSelected = () => {
    if (!selectedBoxId) return;
    setBoxes(prev => prev.filter(b => b.id !== selectedBoxId));
    setSelectedBoxId(null);
  };

  const handleSave = () => {
    onSave(image.id, boxes.map(({color, ...rest}) => rest)); // Strip display color before saving
    onClose();
  };
  
  const handleGeminiAssistRequest = async () => {
    if (!assistPrompt.trim()) {
      setAssistError("Please enter a prompt for Gemini Assist.");
      return;
    }
    setIsAssisting(true);
    setAssistError(null);
    try {
      const newSuggestedBoxes = await onGeminiAssist(image.file, assistPrompt, boxes);
      // Merge new boxes, perhaps mark them for review or add directly
      // For simplicity, directly add them, could add UX for confirmation later
      const boxesWithColors = newSuggestedBoxes.map(b => ({...b, color: getLabelColor(b.label)}));
      setBoxes(prev => [...prev, ...boxesWithColors]);
      setAssistPrompt(''); // Clear prompt after success
    } catch (err: any) {
      setAssistError(err.message || "Gemini Assist failed.");
    } finally {
      setIsAssisting(false);
    }
  };
  
  const selectedBoxDetails = boxes.find(b => b.id === selectedBoxId);

  // Calculate display coordinates for SVG
  const toDisplayCoords = (box: Partial<BoundingBoxType>) => {
    if (!box.x_min || !box.y_min || !box.width || !box.height || imageRenderSize.width === 0) return {};
    return {
      x: box.x_min * imageRenderSize.width + imageRenderSize.offsetX,
      y: box.y_min * imageRenderSize.height + imageRenderSize.offsetY,
      width: box.width * imageRenderSize.width,
      height: box.height * imageRenderSize.height,
    };
  };

  const getHandlePositions = (box: BoundingBoxType) => {
    const disp = toDisplayCoords(box);
    if (!disp.x) return []; // Box not ready
    const handleRad = 5; // pixels
    return [ //nw, ne, sw, se for now
        { id: 'nw', cx: disp.x, cy: disp.y, cursor: 'nwse-resize' },
        { id: 'ne', cx: disp.x + disp.width, cy: disp.y, cursor: 'nesw-resize' },
        { id: 'sw', cx: disp.x, cy: disp.y + disp.height, cursor: 'nesw-resize' },
        { id: 'se', cx: disp.x + disp.width, cy: disp.y + disp.height, cursor: 'nwse-resize' },
    ];
  };


  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="annotator-title">
      <div className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 id="annotator-title" className="text-2xl font-semibold text-gray-100">Interactive Annotator: <span className="font-normal text-sky-400">{image.name}</span></h2>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-gray-700" aria-label="Close editor">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-grow flex flex-col md:flex-row gap-4 min-h-0">
          {/* Image and SVG area */}
          <div className="flex-grow md:w-2/3 relative bg-black rounded-md overflow-hidden border border-gray-700">
            <img ref={imageRef} src={image.dataUrl} alt={image.name} className="absolute top-0 left-0 w-full h-full object-contain" />
            <svg
              ref={svgRef}
              className="absolute top-0 left-0 w-full h-full"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp} // End drawing if mouse leaves SVG
              style={{ cursor: interactionMode === 'draw' ? 'crosshair' : 'default' }}
            >
              {boxes.map(box => {
                const { x, y, width, height } = toDisplayCoords(box);
                if (x === undefined) return null;
                const isSelected = box.id === selectedBoxId;
                return (
                  <g key={box.id} className={isSelected && interactionMode === 'move' ? "cursor-move" : "cursor-default"}>
                    <rect
                      x={x} y={y} width={width} height={height}
                      stroke={box.color || '#FF0000'}
                      fill={isSelected ? `${box.color || '#FF0000'}33` : 'transparent'}
                      strokeWidth={isSelected ? 3 : 2}
                      className={isSelected ? "ring-2 ring-offset-1 ring-white" : ""}
                    />
                    <text x={(x || 0) + 5} y={(y || 0) + 15} fill={box.color || '#FF0000'} fontSize="12px" fontWeight="bold"
                         style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: '2.5px', pointerEvents: 'none' }}>
                      {box.label}
                    </text>
                    {/* Resize Handles for selected box */}
                    {isSelected && getHandlePositions(box).map(handle => (
                        <circle key={handle.id} cx={handle.cx} cy={handle.cy} r="5" fill={box.color || '#FF0000'} stroke="white" strokeWidth="1"
                                style={{ cursor: handle.cursor }}
                                onMouseDown={(e) => {
                                    e.stopPropagation(); // Prevent SVG mousedown from firing for box selection
                                    setInteractionMode('resize');
                                    setResizeHandle(handle.id as ResizeHandle);
                                    // Store initial box state for resizing relative to anchor points (more complex logic needed here)
                                    const currentBoxCoords = getNormalizedCoords(e.clientX, e.clientY);
                                    // Fix: Ensure startX, startY are part of InteractionState when spreading box
                                    if(currentBoxCoords) setCurrentDrawingBox({startX: currentBoxCoords.x, startY: currentBoxCoords.y, ...box});
                                }}
                        />
                    ))}
                  </g>
                );
              })}
              {interactionMode === 'draw' && currentDrawingBox && currentDrawingBox.width && currentDrawingBox.height && (() => {
                const { x, y, width, height } = toDisplayCoords(currentDrawingBox);
                if (x === undefined) return null;
                return <rect x={x} y={y} width={width} height={height} strokeDasharray="5,5" stroke="#FFFFFF" fill="#FFFFFF33" strokeWidth="2" />;
              })()}
            </svg>
          </div>

          {/* Controls and Info Panel */}
          <div className="md:w-1/3 flex flex-col space-y-4 overflow-y-auto p-1 pr-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            <div>
              <h3 className="text-lg font-semibold text-gray-200 mb-2">Tools</h3>
              <div className="flex space-x-2 mb-2">
                <button onClick={() => setInteractionMode('select')} className={`px-3 py-1.5 rounded-md text-sm ${interactionMode === 'select' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Select</button>
                <button onClick={() => setInteractionMode('draw')} className={`px-3 py-1.5 rounded-md text-sm ${interactionMode === 'draw' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Draw Box</button>
              </div>
            </div>

            {selectedBoxDetails && (
              <div className="bg-gray-750 p-3 rounded-md">
                <h3 className="text-lg font-semibold text-gray-200 mb-2">Edit Box: <span className="text-sky-400">{selectedBoxDetails.label}</span></h3>
                <label htmlFor="boxLabel" className="block text-sm font-medium text-gray-300">Label:</label>
                <input
                  type="text"
                  id="boxLabel"
                  value={selectedBoxDetails.label}
                  onChange={handleLabelChange}
                  className="w-full mt-1 p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-xs text-gray-400 mt-1">Source: {selectedBoxDetails.source}</p>
                <button onClick={handleDeleteSelected} className="mt-3 w-full px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm">Delete Selected Box</button>
              </div>
            )}

            <div className="bg-gray-750 p-3 rounded-md">
              <h3 className="text-lg font-semibold text-gray-200 mb-2">Gemini Assist</h3>
              <p className="text-xs text-gray-400 mb-2">Ask Gemini to help find more objects or clarify something in the image.</p>
              <textarea
                value={assistPrompt}
                onChange={(e) => setAssistPrompt(e.target.value)}
                placeholder="e.g., 'Find all small circles' or 'What type of car is this?'"
                rows={2}
                className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 focus:ring-1 focus:ring-sky-500 placeholder-gray-500"
                disabled={isAssisting}
              />
              <button
                onClick={handleGeminiAssistRequest}
                disabled={isAssisting || !assistPrompt.trim()}
                className="mt-2 w-full px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm disabled:opacity-50 flex items-center justify-center"
              >
                {isAssisting ? <><Spinner size="w-4 h-4 mr-2"/> Assisting...</> : 'Ask Gemini'}
              </button>
              {assistError && <p className="mt-2 text-xs text-red-400">{assistError}</p>}
            </div>
            <div className="pt-auto"> {/* Pushes save to bottom of this panel section */}
                 <p className="text-xs text-gray-400 mb-3">Current boxes: {boxes.length}</p>
                <button onClick={handleSave} className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg">Save Changes & Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractiveAnnotator;