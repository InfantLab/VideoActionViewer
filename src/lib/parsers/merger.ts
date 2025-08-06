// Data merger utility for combining VideoAnnotator pipeline outputs
// Merges person tracking, speech recognition, speaker diarization, and scene detection
// into a unified StandardAnnotationData structure

import type {
    StandardAnnotationData,
    COCOPersonAnnotation,
    WebVTTCue,
    RTTMSegment,
    SceneAnnotation,
    LAIONFaceAnnotation,
    VideoAnnotatorCompleteResults
} from '@/types/annotations';

import { parseWebVTT } from './webvtt';
import { parseRTTM } from './rttm';
import { parseCOCOPersonData } from './coco';
import { parseSceneDetection } from './scene';
// import { parseFaceAnalysis } from './face'; // Using local implementation

/**
 * File type detection result
 */
export interface DetectedFile {
    file: File;
    type: 'video' | 'person_tracking' | 'speech_recognition' | 'speaker_diarization' | 'scene_detection' | 'face_analysis' | 'complete_results' | 'audio' | 'unknown';
    pipeline?: string;
    confidence: number;
}

/**
 * Parsing progress callback
 */
export type ProgressCallback = (stage: string, progress: number, total: number) => void;

/**
 * Parsing result with metadata
 */
export interface ParseResult {
    data: StandardAnnotationData;
    metadata: {
        filesProcessed: number;
        pipelinesFound: string[];
        warnings: string[];
        processingTime: number;
    };
}

/**
 * Detects file type based on extension and content
 */
export async function detectFileType(file: File): Promise<DetectedFile> {
    const extension = file.name.toLowerCase().split('.').pop() || '';
    const mimeType = file.type.toLowerCase();

    // Video files
    if (['mp4', 'webm', 'avi', 'mov'].includes(extension) || mimeType.startsWith('video/')) {
        return { file, type: 'video', confidence: 0.95 };
    }

    // Audio files
    if (['wav', 'mp3', 'aac', 'ogg'].includes(extension) || mimeType.startsWith('audio/')) {
        return { file, type: 'audio', confidence: 0.95 };
    }

    // Text files - need content analysis
    if (extension === 'vtt' || file.name.includes('speech_recognition')) {
        const isValid = await isValidWebVTT(file);
        return {
            file,
            type: 'speech_recognition',
            pipeline: 'speech_recognition',
            confidence: isValid ? 0.9 : 0.3
        };
    }

    if (extension === 'rttm' || file.name.includes('speaker_diarization')) {
        const isValid = await isValidRTTM(file);
        return {
            file,
            type: 'speaker_diarization',
            pipeline: 'speaker_diarization',
            confidence: isValid ? 0.9 : 0.3
        };
    }

    // JSON files - need content analysis
    if (extension === 'json' || mimeType === 'application/json') {
        return await detectJSONType(file);
    }

    return { file, type: 'unknown', confidence: 0.0 };
}

/**
 * Detects JSON file type based on content structure
 */
async function detectJSONType(file: File): Promise<DetectedFile> {
    try {
        // DEBUG: Log JSON detection attempt
        console.log('🔍 detectJSONType for', file.name);

        // Check for VideoAnnotator v1.1.1 complete results format FIRST
        // (before trying to parse partial JSON)
        if (await isValidCompleteResults(file)) {
            console.log('✅ Detected as complete_results');
            return {
                file,
                type: 'complete_results',
                pipeline: 'complete_results',
                confidence: 0.95
            };
        }

        // If not complete results, try parsing a sample for other JSON types
        const sample = await file.slice(0, 5000).text();
        const data = JSON.parse(sample);

        // Check for face analysis (LAION format)
        if (await isValidFaceAnalysis(file)) {
            return {
                file,
                type: 'face_analysis',
                pipeline: 'face_analysis',
                confidence: 0.8
            };
        }

        // Check for person tracking (COCO format)
        if (await isValidCOCOPersonData(file)) {
            return {
                file,
                type: 'person_tracking',
                pipeline: 'person_tracking',
                confidence: 0.8
            };
        }

        // Check for scene detection
        if (await isValidSceneDetection(file)) {
            return {
                file,
                type: 'scene_detection',
                pipeline: 'scene_detection',
                confidence: 0.8
            };
        }

        // Check filename patterns for v1.1.1 naming
        if (file.name.includes('complete_results')) {
            return { file, type: 'complete_results', pipeline: 'complete_results', confidence: 0.7 };
        }

        if (file.name.includes('face_annotations') || file.name.includes('laion_face')) {
            return { file, type: 'face_analysis', pipeline: 'face_analysis', confidence: 0.6 };
        }

        if (file.name.includes('person') || file.name.includes('tracking')) {
            return { file, type: 'person_tracking', pipeline: 'person_tracking', confidence: 0.5 };
        }

        if (file.name.includes('scene')) {
            return { file, type: 'scene_detection', pipeline: 'scene_detection', confidence: 0.5 };
        }

        return { file, type: 'unknown', confidence: 0.2 };

    } catch (error) {
        console.log('❌ detectJSONType failed for', file.name, ':', error);
        return { file, type: 'unknown', confidence: 0.0 };
    }
}

/**
 * Helper functions for file validation (imported from parsers)
 */
async function isValidWebVTT(file: File): Promise<boolean> {
    try {
        const firstLine = await file.slice(0, 100).text();
        return firstLine.trim().startsWith('WEBVTT');
    } catch {
        return false;
    }
}

async function isValidRTTM(file: File): Promise<boolean> {
    try {
        const firstLines = await file.slice(0, 1000).text();
        return firstLines.includes('SPEAKER');
    } catch {
        return false;
    }
}

async function isValidCOCOPersonData(file: File): Promise<boolean> {
    try {
        const sample = await file.slice(0, 2000).text();
        const data = JSON.parse(sample);

        if (Array.isArray(data)) {
            return data.length === 0 || (data[0] && 'keypoints' in data[0] && 'bbox' in data[0]);
        }

        return (data.annotations && Array.isArray(data.annotations)) ||
            (data.results && Array.isArray(data.results));
    } catch {
        return false;
    }
}

async function isValidSceneDetection(file: File): Promise<boolean> {
    try {
        const sample = await file.slice(0, 2000).text();
        const data = JSON.parse(sample);

        if (Array.isArray(data)) {
            return data.length === 0 || (data[0] && ('start_time' in data[0] || 'startTime' in data[0]));
        }

        return (data.results && Array.isArray(data.results)) ||
            (data.scenes && Array.isArray(data.scenes)) ||
            (data.annotations && data.annotations[0] && 'scene_type' in data.annotations[0]);
    } catch {
        return false;
    }
}

async function isValidCompleteResults(file: File): Promise<boolean> {
    try {
        // For complete_results.json, read the entire file since we need it anyway
        const text = await file.text();
        
        // DEBUG: Show first 200 characters of file for debugging malformed JSON
        console.log('🔍 isValidCompleteResults for', file.name);
        console.log('  - First 200 chars:', text.substring(0, 200));
        
        const data = JSON.parse(text);

        const isValid = !!(data.video_path && 
                          data.pipeline_results && 
                          data.config && 
                          data.start_time &&
                          data.total_duration !== undefined);

        // DEBUG: Log file detection results
        console.log('  - has video_path:', !!data.video_path);
        console.log('  - has pipeline_results:', !!data.pipeline_results);
        console.log('  - has config:', !!data.config);
        console.log('  - has start_time:', !!data.start_time);
        console.log('  - has total_duration:', data.total_duration !== undefined);
        console.log('  - overall valid:', isValid);

        return isValid;
    } catch (error) {
        console.log('❌ isValidCompleteResults failed for', file.name, ':', error);
        
        // Try to show problematic area of JSON
        try {
            const text = await file.text();
            const lines = text.split('\n');
            console.log('  - JSON structure around error:');
            lines.slice(0, 5).forEach((line, idx) => {
                console.log(`    Line ${idx + 1}: ${line}`);
            });
        } catch (debugError) {
            console.log('  - Could not debug malformed JSON');
        }
        
        return false;
    }
}

async function isValidFaceAnalysis(file: File): Promise<boolean> {
    try {
        const sample = await file.slice(0, 2000).text();
        const data = JSON.parse(sample);

        if (Array.isArray(data)) {
            return data.length === 0 || (data[0] && 'face_id' in data[0] && 'attributes' in data[0]);
        }

        return (data.annotations && data.annotations[0] && 'face_id' in data.annotations[0]) ||
               (data.results && data.results[0] && 'face_id' in data.results[0]);
    } catch {
        return false;
    }
}

/**
 * Parses VideoAnnotator v1.1.1 complete results format
 */
async function parseCompleteResults(file: File): Promise<{
    personTracking: COCOPersonAnnotation[];
    faceAnalysis: LAIONFaceAnnotation[];
    sceneDetection: SceneAnnotation[];
    config: VideoAnnotatorCompleteResults['config'];
    processingTime: number;
    totalDuration: number;
}> {
    const text = await file.text();
    const data: VideoAnnotatorCompleteResults = JSON.parse(text);

    // DEBUG: Log raw data structure
    console.log('🔍 parseCompleteResults: Raw data structure');
    console.log('  - pipeline_results keys:', Object.keys(data.pipeline_results || {}));
    console.log('  - person section exists:', !!data.pipeline_results.person);
    console.log('  - person results count:', data.pipeline_results.person?.results?.length || 0);

    const personTracking = data.pipeline_results.person?.results || [];
    const faceAnalysis = data.pipeline_results.face?.results || [];
    const sceneDetection = data.pipeline_results.scene?.results || [];

    console.log('🔍 parseCompleteResults: Parsed arrays');
    console.log('  - personTracking length:', personTracking.length);
    console.log('  - faceAnalysis length:', faceAnalysis.length);
    console.log('  - sceneDetection length:', sceneDetection.length);

    return {
        personTracking,
        faceAnalysis,
        sceneDetection,
        config: data.config,
        processingTime: Object.values(data.pipeline_results).reduce((sum, result) => sum + (result?.processing_time || 0), 0),
        totalDuration: data.total_duration
    };
}

/**
 * Parses face analysis file (LAION format)
 */
async function parseFaceAnalysis(file: File): Promise<LAIONFaceAnnotation[]> {
    const text = await file.text();
    const data = JSON.parse(text);

    if (Array.isArray(data)) {
        return data;
    }

    if (data.annotations && Array.isArray(data.annotations)) {
        return data.annotations;
    }

    if (data.results && Array.isArray(data.results)) {
        return data.results;
    }

    return [];
}

/**
 * Extracts video information from video file
 */
async function extractVideoInfo(videoFile: File): Promise<StandardAnnotationData['video_info']> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(videoFile);

        video.onloadedmetadata = () => {
            const info = {
                filename: videoFile.name,
                duration: video.duration,
                width: video.videoWidth,
                height: video.videoHeight,
                frame_rate: 30 // Default, could be extracted with more advanced techniques
            };

            URL.revokeObjectURL(url);
            resolve(info);
        };

        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load video metadata'));
        };

        video.src = url;
    });
}

/**
 * Merges all pipeline outputs into unified annotation data
 */
export async function mergeAnnotationData(
    detectedFiles: DetectedFile[],
    onProgress?: ProgressCallback
): Promise<ParseResult> {
    // DEBUG: Log incoming files
    console.log('🔍 mergeAnnotationData called with', detectedFiles.length, 'detected files:');
    detectedFiles.forEach((df, i) => {
        console.log(`  ${i}: ${df.file.name} -> type: ${df.type}, pipeline: ${df.pipeline}, confidence: ${df.confidence}`);
    });

    const startTime = Date.now();
    const warnings: string[] = [];
    const pipelinesFound: string[] = [];

    let videoFile: File | undefined;
    let audioFile: File | undefined;
    let personTracking: COCOPersonAnnotation[] = [];
    let speechRecognition: WebVTTCue[] = [];
    let speakerDiarization: RTTMSegment[] = [];
    let sceneDetection: SceneAnnotation[] = [];
    let faceAnalysis: LAIONFaceAnnotation[] = [];

    // Processing metadata from VideoAnnotator v1.1.1
    let processingConfig: VideoAnnotatorCompleteResults['config'] | undefined;
    let processingTime: number | undefined;
    let totalDuration: number | undefined;

    const totalFiles = detectedFiles.length;
    let processedFiles = 0;

    // Check for complete results file first (highest priority)
    const completeResultsFile = detectedFiles.find(f => f.type === 'complete_results');
    
    if (completeResultsFile) {
        try {
            onProgress?.(`Processing ${completeResultsFile.file.name}`, processedFiles, totalFiles);
            
            const completeResults = await parseCompleteResults(completeResultsFile.file);
            personTracking = completeResults.personTracking;
            faceAnalysis = completeResults.faceAnalysis;
            sceneDetection = completeResults.sceneDetection;
            processingConfig = completeResults.config;
            
            // DEBUG: Log parsing results
            console.log('🔍 Complete results parsed:');
            console.log('  - Person tracking entries:', personTracking?.length || 0);
            console.log('  - Face analysis entries:', faceAnalysis?.length || 0);
            console.log('  - Scene detection entries:', sceneDetection?.length || 0);
            if (personTracking && personTracking.length > 0) {
                console.log('  - First person entry:', personTracking[0]);
            }
            processingTime = completeResults.processingTime;
            totalDuration = completeResults.totalDuration;

            if (personTracking.length > 0) pipelinesFound.push('person_tracking');
            if (faceAnalysis.length > 0) pipelinesFound.push('face_analysis');
            if (sceneDetection.length > 0) pipelinesFound.push('scene_detection');

            processedFiles++;
        } catch (error) {
            warnings.push(`Failed to parse complete results ${completeResultsFile.file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Process remaining files (for speech/speaker data or if no complete results)
    for (const detectedFile of detectedFiles) {
        if (detectedFile === completeResultsFile) continue; // Skip already processed

        try {
            onProgress?.(`Processing ${detectedFile.file.name}`, processedFiles, totalFiles);

            switch (detectedFile.type) {
                case 'video':
                    videoFile = detectedFile.file;
                    break;

                case 'audio':
                    audioFile = detectedFile.file;
                    break;

                case 'person_tracking':
                    if (personTracking.length === 0) { // Only if not from complete results
                        personTracking = await parseCOCOPersonData(detectedFile.file);
                        pipelinesFound.push('person_tracking');
                    }
                    break;

                case 'face_analysis':
                    if (faceAnalysis.length === 0) { // Only if not from complete results
                        faceAnalysis = await parseFaceAnalysis(detectedFile.file);
                        pipelinesFound.push('face_analysis');
                    }
                    break;

                case 'speech_recognition':
                    speechRecognition = await parseWebVTT(detectedFile.file);
                    pipelinesFound.push('speech_recognition');
                    break;

                case 'speaker_diarization':
                    speakerDiarization = await parseRTTM(detectedFile.file);
                    pipelinesFound.push('speaker_diarization');
                    break;

                case 'scene_detection':
                    if (sceneDetection.length === 0) { // Only if not from complete results
                        sceneDetection = await parseSceneDetection(detectedFile.file);
                        pipelinesFound.push('scene_detection');
                    }
                    break;

                case 'unknown':
                    warnings.push(`Could not determine type of file: ${detectedFile.file.name}`);
                    break;
            }
        } catch (error) {
            warnings.push(`Failed to parse ${detectedFile.file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        processedFiles++;
    }

    // Extract video information
    if (!videoFile) {
        throw new Error('No video file provided');
    }

    onProgress?.('Extracting video metadata', processedFiles, totalFiles + 1);
    const video_info = await extractVideoInfo(videoFile);

    // Create unified annotation data
    const data: StandardAnnotationData = {
        video_info,
        metadata: {
            created: new Date().toISOString(),
            version: '1.1.1',
            pipelines: pipelinesFound,
            source: 'videoannotator',
            // NEW v1.1.1 metadata
            processing_config: processingConfig,
            processing_time: processingTime,
            total_duration: totalDuration
        }
    };

    // Add pipeline data if available
    if (personTracking.length > 0) {
        data.person_tracking = personTracking;
    }

    if (speechRecognition.length > 0) {
        data.speech_recognition = speechRecognition;
    }

    if (speakerDiarization.length > 0) {
        data.speaker_diarization = speakerDiarization;
    }

    if (sceneDetection.length > 0) {
        data.scene_detection = sceneDetection;
    }

    if (faceAnalysis.length > 0) {
        data.face_analysis = faceAnalysis;
    }

    if (audioFile) {
        data.audio_file = audioFile;
    }

    const totalProcessingTime = Date.now() - startTime;

    onProgress?.('Merging complete', totalFiles + 1, totalFiles + 1);

    return {
        data,
        metadata: {
            filesProcessed: processedFiles,
            pipelinesFound,
            warnings,
            processingTime: totalProcessingTime
        }
    };
}

/**
 * Batch detect file types for multiple files
 */
export async function batchDetectFileTypes(files: File[]): Promise<DetectedFile[]> {
    const results = await Promise.all(
        files.map(file => detectFileType(file))
    );

    // Sort by confidence (highest first)
    return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Validates that required files are present
 */
export function validateFileSet(detectedFiles: DetectedFile[]): {
    isValid: boolean;
    missing: string[];
    suggestions: string[];
} {
    const types = new Set(detectedFiles.map(f => f.type));
    const missing: string[] = [];
    const suggestions: string[] = [];

    if (!types.has('video')) {
        missing.push('Video file');
        suggestions.push('Add a video file (.mp4, .webm, .avi, .mov)');
    }

    const hasPipelineData = types.has('person_tracking') ||
        types.has('speech_recognition') ||
        types.has('speaker_diarization') ||
        types.has('scene_detection') ||
        types.has('face_analysis') ||
        types.has('complete_results');

    if (!hasPipelineData) {
        missing.push('Pipeline data');
        suggestions.push('Add at least one annotation file (.json for tracking/scenes, .vtt for speech, .rttm for speakers)');
    }

    return {
        isValid: missing.length === 0,
        missing,
        suggestions
    };
}

/**
 * Gets summary of detected files for UI display
 */
export function getFilesSummary(detectedFiles: DetectedFile[]): {
    video?: string;
    audio?: string;
    pipelines: Array<{ name: string; file: string; confidence: number }>;
    unknown: string[];
} {
    const summary: {
        video?: string;
        audio?: string;
        pipelines: Array<{ name: string; file: string; confidence: number }>;
        unknown: string[];
    } = {
        pipelines: [],
        unknown: []
    };

    for (const detected of detectedFiles) {
        switch (detected.type) {
            case 'video':
                summary.video = detected.file.name;
                break;
            case 'audio':
                summary.audio = detected.file.name;
                break;
            case 'person_tracking':
            case 'speech_recognition':
            case 'speaker_diarization':
            case 'scene_detection':
            case 'face_analysis':
            case 'complete_results':
                summary.pipelines.push({
                    name: detected.pipeline || detected.type,
                    file: detected.file.name,
                    confidence: detected.confidence
                });
                break;
            case 'unknown':
                summary.unknown.push(detected.file.name);
                break;
        }
    }

    return summary;
}
