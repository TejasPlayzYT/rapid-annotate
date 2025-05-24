
import React, { useState, useCallback, useEffect } from 'react';
import type { UploadedImage, ProcessedImageResult, BoundingBox, EditingImageState, AnnotationMode } from './types';
import ImageUploader from './components/ImageUploader';
import AnnotatedImageDisplay from './components/AnnotatedImageDisplay';
import ExportControls from './components/ExportControls';
import Spinner from './components/Spinner';
import Alert from './components/Alert';
import InteractiveAnnotator from './components/InteractiveAnnotator';
import { generateBoundingBoxesForImages, generateAssistedAnnotations } from './services/geminiService';
import { resetLabelColors } from './utils/colorUtils';
import { GEMINI_IMAGE_BATCH_SIZE } from './constants';

const App: React.FC = () => {
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [promptText, setPromptText] = useState<string>('Identify all distinct objects such as cars, people, signs, and animals.');
  const [processedResults, setProcessedResults] = useState<ProcessedImageResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("Gemini is thinking...");
  const [error, setError] = useState<string | null>(null);
  const [apiKeyMissingError, setApiKeyMissingError] = useState<boolean>(false);

  const [editingState, setEditingState] = useState<EditingImageState | null>(null);


  useEffect(() => {
    if (!process.env.API_KEY) {
      setApiKeyMissingError(true);
      setError("Critical: Gemini API Key (API_KEY) is not configured in the environment. The application cannot function.");
    }
  }, []);


  const handleImagesUploaded = useCallback((newImages: UploadedImage[]) => {
    setUploadedImages(prevImages => {
      // Allow appending new images or replacing if context changes (e.g. mode switch)
      const combinedImages = [...prevImages, ...newImages];
      // Remove duplicates by ID if any from re-uploads
      const uniqueImages = Array.from(new Map(combinedImages.map(img => [img.id, img])).values());

      if (uniqueImages.length > 0) {
        setError(null); 
        resetLabelColors();
      }
      
      // If in assistive mode, initialize empty processed results for new images
      if (annotationMode === 'assistive') {
        const newResultsForAssistive: ProcessedImageResult[] = uniqueImages
          .filter(img => !processedResults.some(pr => pr.imageId === img.id)) // only for new images
          .map(img => ({
            imageId: img.id,
            originalFileName: img.name,
            originalWidth: img.naturalWidth,
            originalHeight: img.naturalHeight,
            boxes: [],
          }));
        setProcessedResults(prev => [...prev, ...newResultsForAssistive]);
      } else {
        // For automatic mode, clear old results if new images are uploaded (or if all are cleared)
        // This logic might need refinement based on desired behavior for adding more images to an existing automatic set
         setProcessedResults([]); 
      }
      return uniqueImages;
    });
  }, [annotationMode, processedResults]);

  const handleClearAll = () => {
    setUploadedImages([]);
    setProcessedResults([]);
    setError(null);
    setEditingState(null);
    resetLabelColors();
    // Optionally reset annotationMode to null to show mode selection again
    // setAnnotationMode(null); 
  };

  const handleSubmitForAnnotation = async () => {
    if (apiKeyMissingError) {
      setError("Cannot proceed: Gemini API Key is not configured.");
      return;
    }
    if (uploadedImages.length === 0) {
      setError("Please upload at least one image.");
      return;
    }
    if (!promptText.trim()) {
      setError("Please enter a text prompt describing what to detect.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProcessedResults([]); 
    resetLabelColors(); 
    
    let allResults: ProcessedImageResult[] = [];
    const totalImages = uploadedImages.length;
    const numBatches = Math.ceil(totalImages / GEMINI_IMAGE_BATCH_SIZE);

    try {
      for (let i = 0; i < numBatches; i++) {
        const batchStart = i * GEMINI_IMAGE_BATCH_SIZE;
        const batchEnd = batchStart + GEMINI_IMAGE_BATCH_SIZE;
        const imageBatch = uploadedImages.slice(batchStart, batchEnd);
        
        setLoadingMessage(`Processing batch ${i + 1} of ${numBatches} (${imageBatch.length} images)...`);
        
        const batchResults = await generateBoundingBoxesForImages(imageBatch, promptText);
        allResults = [...allResults, ...batchResults];
        // Update processedResults incrementally to show progress if desired, or all at once at the end
        setProcessedResults([...allResults]); 
      }

      if (allResults.every(r => r.boxes.length === 0)) {
        setError("Gemini processed all images, but no objects matching your query were found.");
      }
    } catch (e: any) {
      console.error("Annotation generation failed:", e);
      setError(e.message || "An unknown error occurred while generating annotations.");
      setProcessedResults(allResults); // Show partial results if any error occurred mid-batching
    } finally {
      setIsLoading(false);
      setLoadingMessage("Gemini is thinking..."); // Reset
    }
  };

  const handleOpenEditor = (image: UploadedImage, result?: ProcessedImageResult) => {
    // Find the current result for this image, ensuring it exists.
    // If in assistive mode and it's a new image, it might not have a result yet, or an empty one.
    let annotationsForImage: BoundingBox[] = [];
    const existingResult = processedResults.find(r => r.imageId === image.id);

    if (existingResult) {
        annotationsForImage = existingResult.boxes;
    } else if (annotationMode === 'assistive') {
        // If assistive mode and no result, create an empty one. This path should ideally be covered by handleImagesUploaded.
        const newEmptyResult: ProcessedImageResult = {
            imageId: image.id,
            originalFileName: image.name,
            originalWidth: image.naturalWidth,
            originalHeight: image.naturalHeight,
            boxes: [],
        };
        setProcessedResults(prev => [...prev, newEmptyResult]);
        annotationsForImage = newEmptyResult.boxes;
    }


    setEditingState({
      image: image,
      annotations: annotationsForImage,
    });
     resetLabelColors(); 
  };

  const handleCloseEditor = () => {
    setEditingState(null);
  };

  const handleSaveAnnotations = (imageId: string, updatedAnnotations: BoundingBox[]) => {
    setProcessedResults(prevResults => {
      const resultIndex = prevResults.findIndex(r => r.imageId === imageId);
      if (resultIndex > -1) {
        const updatedResults = [...prevResults];
        updatedResults[resultIndex] = { ...updatedResults[resultIndex], boxes: updatedAnnotations };
        return updatedResults;
      } else { 
        const imageMeta = uploadedImages.find(img => img.id === imageId);
        if (imageMeta) { // Should only happen if result was missing, e.g. assistive mode first edit
           return [...prevResults, {
               imageId: imageId,
               originalFileName: imageMeta.name,
               originalWidth: imageMeta.naturalWidth,
               originalHeight: imageMeta.naturalHeight,
               boxes: updatedAnnotations
           }];
        }
      }
      return prevResults;
    });
    resetLabelColors(); 
    setEditingState(null); 
  };
  
  const handleGeminiAssistInEditor = async (
    imageFile: File, 
    assistPrompt: string, 
    currentAnnotations: BoundingBox[]
  ): Promise<BoundingBox[]> => {
    return generateAssistedAnnotations(imageFile, assistPrompt, currentAnnotations);
  };

  const renderModeSelection = () => (
    <section className="w-full max-w-2xl bg-gray-800 p-8 rounded-xl shadow-2xl text-center">
      <h2 className="text-3xl font-semibold text-gray-100 mb-6">Choose Your Annotation Workflow</h2>
      <p className="text-gray-400 mb-8">How would you like to annotate your images?</p>
      <div className="grid md:grid-cols-2 gap-6">
        <button
          onClick={() => setAnnotationMode('automatic')}
          className="p-6 bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75"
        >
          <h3 className="text-xl font-bold mb-2">Automatic + Review</h3>
          <p className="text-sm text-sky-100">Let Gemini detect objects in all images based on your prompt. Then review and edit.</p>
        </button>
        <button
          onClick={() => {
            setAnnotationMode('assistive');
            // If images are already uploaded, initialize empty results for them
            if(uploadedImages.length > 0 && processedResults.length === 0){
                 const initialAssistiveResults = uploadedImages.map(img => ({
                    imageId: img.id,
                    originalFileName: img.name,
                    originalWidth: img.naturalWidth,
                    originalHeight: img.naturalHeight,
                    boxes: [],
                }));
                setProcessedResults(initialAssistiveResults);
            }
          }}
          className="p-6 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75"
        >
          <h3 className="text-xl font-bold mb-2">AI Assist Environment</h3>
          <p className="text-sm text-teal-100">Manually annotate or use Gemini Assist on a per-image basis for targeted suggestions.</p>
        </button>
      </div>
    </section>
  );

  const renderAppContent = () => (
    <>
      <section className="bg-gray-800 p-6 rounded-xl shadow-2xl">
        <h2 className="text-2xl font-semibold text-gray-100 mb-4">
          {annotationMode === 'automatic' ? "1. Upload Images for Automatic Annotation" : "1. Upload Images to Annotate"}
        </h2>
        <ImageUploader onImagesUploaded={handleImagesUploaded} disabled={isLoading} />
        {uploadedImages.length > 0 && (
          <div className="mt-4 flex justify-between items-center">
            <p className="text-sm text-gray-400">{uploadedImages.length} image(s) uploaded.</p>
            <button
              onClick={handleClearAll}
              disabled={isLoading}
              className="text-sm text-red-400 hover:text-red-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
            >
              Clear All Uploads & Results
            </button>
          </div>
        )}
      </section>

      {annotationMode === 'automatic' && uploadedImages.length > 0 && (
        <section className="bg-gray-800 p-6 rounded-xl shadow-2xl">
          <h2 className="text-2xl font-semibold text-gray-100 mb-4">2. Describe Objects to Detect (All Images)</h2>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="E.g., 'all cars and pedestrians', 'product defects on circuit boards'"
            rows={3}
            disabled={isLoading || apiKeyMissingError}
            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors placeholder-gray-500 disabled:opacity-70"
          />
          <button
            onClick={handleSubmitForAnnotation}
            disabled={isLoading || uploadedImages.length === 0 || !promptText.trim() || apiKeyMissingError}
            className="mt-4 w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75 transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <Spinner size="w-5 h-5 mr-2" /> Processing...
              </>
            ) : (
              "Detect Objects with Gemini"
            )}
          </button>
        </section>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-10 bg-gray-800 rounded-xl shadow-2xl">
          <Spinner size="w-16 h-16" color="text-sky-400" />
          <p className="mt-4 text-xl text-gray-300">{loadingMessage}</p>
          {annotationMode === 'automatic' && <p className="text-sm text-gray-500">Processing images in batches. This might take a while.</p>}
        </div>
      )}
      
      {/* Results display for both modes */}
      {!isLoading && uploadedImages.length > 0 && (processedResults.length > 0 || annotationMode === 'assistive') && (
         <section className="bg-gray-800 p-6 rounded-xl shadow-2xl">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-100">
                    {annotationMode === 'automatic' ? "3. Annotated Images" : "2. Your Images"}
                </h2>
                <p className="text-sm text-sky-300">Click on an image to annotate or edit.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Ensure processedResults has entries for all uploadedImages in assistive mode, even if empty */}
              {uploadedImages.map(img => {
                const resultForThisImage = processedResults.find(r => r.imageId === img.id);
                return (
                  <AnnotatedImageDisplay
                    key={img.id}
                    uploadedImage={img}
                    annotationResult={resultForThisImage} // Will be undefined if no match, or have empty boxes for assistive
                    onImageClick={handleOpenEditor}
                    isClickable={true}
                  />
                );
              })}
            </div>
          </section>
      )}
      
      {!isLoading && processedResults.length > 0 && uploadedImages.length > 0 && (
           <ExportControls 
              processedResults={processedResults} 
              uploadedImages={uploadedImages}
              disabled={isLoading} 
          />
      )}
    </>
  );


  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-8 selection:bg-sky-500 selection:text-white">
      <header className="w-full max-w-5xl mb-8 text-center">
        <div className="flex items-center justify-center space-x-3">
             {annotationMode && (
                 <button 
                    onClick={() => {
                        handleClearAll(); // Clear everything
                        setAnnotationMode(null); // Go back to mode selection
                    }} 
                    className="p-2 rounded-md hover:bg-gray-700 transition-colors text-gray-400 hover:text-sky-300"
                    title="Change Workflow Mode"
                    aria-label="Change workflow mode"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                 </button>
             )}
            <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-600 py-2">
              AI Image Annotator
            </h1>
        </div>

        <p className="text-gray-400 mt-2 text-sm sm:text-base">
          {annotationMode === 'automatic' && "Upload images, describe what to find, and let Gemini draw the boxes. Edit, and Export."}
          {annotationMode === 'assistive' && "Upload images, then manually annotate or use Gemini Assist per image. Edit and Export."}
          {!annotationMode && "Choose a workflow to begin annotating your images with AI assistance."}
        </p>
      </header>

      {error && (
        <div className="w-full max-w-3xl mb-6">
          <Alert 
            type={(error.startsWith("Critical:") || error.includes("API Key") || error.includes("Failed to parse JSON")) ? "error" : "info"}
            message={error} 
            onClose={() => setError(null)} 
          />
        </div>
      )}

      <main className="w-full max-w-5xl space-y-8">
        {!editingState && !annotationMode && renderModeSelection()}
        {!editingState && annotationMode && renderAppContent()}
        
        {editingState && (
          <InteractiveAnnotator
            editingState={editingState}
            onSave={handleSaveAnnotations}
            onClose={handleCloseEditor}
            onGeminiAssist={handleGeminiAssistInEditor}
          />
        )}

      </main>
      {!editingState && annotationMode && (
        <footer className="w-full max-w-5xl mt-12 pt-8 border-t border-gray-700 text-center">
          <p className="text-sm text-gray-500">
            Powered by Gemini AI. &copy; {new Date().getFullYear()} AI Image Annotator.
             Mode: <span className="capitalize font-semibold text-sky-400">{annotationMode}</span>
          </p>
        </footer>
      )}
    </div>
  );
};

export default App;
