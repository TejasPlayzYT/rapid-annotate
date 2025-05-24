import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import type { ImageGenerativePart, BoundingBox, ProcessedImageResult, UploadedImage, AnnotationSource } from '../types';
import { GEMINI_MODEL_NAME, GEMINI_API_REQUEST_PROMPT_TEMPLATE, GEMINI_ASSIST_PROMPT_TEMPLATE } from '../constants';

// Ensure API_KEY is available.
const API_KEY = process.env.API_KEY;

let ai: GoogleGenAI | null = null;
if (API_KEY) {
  ai = new GoogleGenAI({ apiKey: API_KEY });
} else {
  console.error("API_KEY for Gemini is not set. Please set the process.env.API_KEY environment variable.");
}

const fileToGenerativePart = async (file: File): Promise<ImageGenerativePart> => {
  const base64EncodedData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) {
        resolve((reader.result as string).split(',')[1]);
      } else {
        reject(new Error("Failed to read file data."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: {
      mimeType: file.type,
      data: base64EncodedData,
    },
  };
};

const parseGeminiJsonResponse = (responseText: string): any => {
  let jsonStr = responseText.trim();
  const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
  const match = jsonStr.match(fenceRegex);
  if (match && match[1]) {
    jsonStr = match[1].trim();
  }
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON response:", e);
    console.error("Original text from Gemini:", responseText);
    console.error("Cleaned JSON string attempt:", jsonStr);
    throw new Error("Gemini returned an invalid JSON response. The prompt might need adjustment or the model produced unexpected output. Original response: " + responseText);
  }
};


export const generateBoundingBoxesForImages = async (
  uploadedImages: UploadedImage[],
  userPrompt: string
): Promise<ProcessedImageResult[]> => {
  if (!ai) {
    throw new Error("Gemini API client is not initialized. API_KEY might be missing.");
  }
  if (uploadedImages.length === 0) {
    return [];
  }

  try {
    const imagePartsPromises = uploadedImages.map(img => fileToGenerativePart(img.file));
    const imageGenerativeParts: Part[] = await Promise.all(imagePartsPromises);
    
    const fullPrompt = GEMINI_API_REQUEST_PROMPT_TEMPLATE(userPrompt);
    const textPart: Part = { text: fullPrompt };

    // For multiple images, content should be an array of Parts, where each image is a part.
    // The prompt asks Gemini to return an array of arrays of boxes, corresponding to input images.
    const geminiContents: Part[] = [...imageGenerativeParts, textPart];


    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: geminiContents, 
      config: {
        responseMimeType: "application/json",
      },
    });
    
    const resultsPerImageRaw = parseGeminiJsonResponse(response.text);

    if (!Array.isArray(resultsPerImageRaw) || resultsPerImageRaw.length !== uploadedImages.length) {
      console.error("Mismatch between number of images sent and results received, or unexpected format.");
      console.error("Gemini raw response text:", response.text);
      console.error("Parsed resultsPerImage:", resultsPerImageRaw);
      throw new Error(`API returned an unexpected number of results (${resultsPerImageRaw.length} for ${uploadedImages.length} images) or format for the images.`);
    }
    
    return resultsPerImageRaw.map((boxesFromApi: any[], index: number) => {
      const originalImage = uploadedImages[index];
      const validatedBoxes: BoundingBox[] = [];

      if (Array.isArray(boxesFromApi)) {
        boxesFromApi.forEach(b => {
          if (typeof b.label === 'string' &&
              typeof b.x_min === 'number' &&
              typeof b.y_min === 'number' &&
              typeof b.width === 'number' &&
              typeof b.height === 'number') {
            validatedBoxes.push({
              ...b,
              id: crypto.randomUUID(),
              source: 'gemini' as AnnotationSource,
            });
          } else {
            console.warn("Skipping invalid box structure from API:", b);
          }
        });
      } else {
        console.warn(`Expected an array of boxes for image ${index}, but got:`, boxesFromApi);
      }
      
      return {
        imageId: originalImage.id,
        originalFileName: originalImage.name,
        originalWidth: originalImage.naturalWidth,
        originalHeight: originalImage.naturalHeight,
        boxes: validatedBoxes,
      };
    });

  } catch (error: any) {
    console.error("Error calling Gemini API for initial detection:", error);
    let errorMessage = "Failed to generate bounding boxes.";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    if (error.message && error.message.includes("API key not valid")) {
         throw new Error("Invalid Gemini API Key. Please check your configuration.");
    }
    if (error.message && (error.message.includes("resource has been exhausted") || error.message.includes("Quota exceeded"))) {
        throw new Error("Gemini API quota exceeded. Please try again later.");
    }
    throw new Error(errorMessage);
  }
};

export const generateAssistedAnnotations = async (
  imageFile: File,
  userAssistPrompt: string,
  existingAnnotations?: BoundingBox[]
): Promise<BoundingBox[]> => {
  if (!ai) {
    throw new Error("Gemini API client is not initialized. API_KEY might be missing.");
  }

  try {
    const imagePart = await fileToGenerativePart(imageFile);
    const simplifiedExistingAnnotations = existingAnnotations?.map(b => ({
        label: b.label, x_min: b.x_min, y_min: b.y_min, width: b.width, height: b.height
    }));

    const fullPrompt = GEMINI_ASSIST_PROMPT_TEMPLATE(userAssistPrompt, simplifiedExistingAnnotations);
    const textPart: Part = { text: fullPrompt };
    
    const geminiContents: Part[] = [imagePart, textPart];

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: geminiContents,
      config: {
        responseMimeType: "application/json",
         // For assistive tasks, slightly lower temperature might be better for more factual/constrained responses
        temperature: 0.5 
      },
    });

    const newBoxesRaw = parseGeminiJsonResponse(response.text);
    const validatedNewBoxes: BoundingBox[] = [];

    if (Array.isArray(newBoxesRaw)) {
      newBoxesRaw.forEach(b => {
        if (typeof b.label === 'string' &&
            typeof b.x_min === 'number' &&
            typeof b.y_min === 'number' &&
            typeof b.width === 'number' &&
            typeof b.height === 'number') {
          validatedNewBoxes.push({
            ...b,
            id: crypto.randomUUID(),
            source: 'gemini-assisted' as AnnotationSource,
          });
        } else {
            console.warn("Skipping invalid box structure from Gemini Assist API:", b);
        }
      });
    } else {
        console.warn("Gemini Assist API returned non-array data:", newBoxesRaw);
    }
    return validatedNewBoxes;

  } catch (error: any) {
    console.error("Error calling Gemini API for assistance:", error);
    let errorMessage = "Failed to get assistance from Gemini.";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    if (error.message && error.message.includes("API key not valid")) {
         throw new Error("Invalid Gemini API Key. Please check your configuration.");
    }
    if (error.message && (error.message.includes("resource has been exhausted") || error.message.includes("Quota exceeded"))) {
        throw new Error("Gemini API quota exceeded. Please try again later.");
    }
    throw new Error(errorMessage);
  }
};