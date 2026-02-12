/**
 * Utility functions for FlexCell NX 1.14
 */

import * as pdfjsLib from 'pdfjs-dist';
import { ColorDetection, PdfDimensions, OrderItem } from './types';

// Logger instance
export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${new Date().toISOString()}: ${message}`, data || '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, data || '');
  },
  error: (message: string, error?: Error | unknown) => {
    console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, error instanceof Error ? error.message : error);
  },
  debug: (message: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()}: ${message}`, data || '');
    }
  },
};

// ============ VALIDATION HELPERS ============

/**
 * Valida endereço de email
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Valida dimensões (altura e largura)
 */
export const validateDimensions = (width: number, height: number): { valid: boolean; error?: string } => {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return { valid: false, error: 'Dimensões devem ser números' };
  }
  if (isNaN(width) || isNaN(height)) {
    return { valid: false, error: 'Dimensões contêm valores inválidos' };
  }
  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Dimensões devem ser maiores que zero' };
  }
  if (width > 500 || height > 500) {
    return { valid: false, error: 'Dimensões muito grandes (máximo 500cm)' };
  }
  return { valid: true };
};

/**
 * Valida e normaliza quantidade de jogos
 */
export const validateGames = (games: any): number => {
  const parsed = parseInt(games, 10);
  return Math.max(1, isNaN(parsed) ? 1 : parsed);
};

/**
 * Valida tamanho de string de email
 */
export const validateEmailSize = (itemsCount: number, maxBytes: number = 4000): { valid: boolean; maxItems: number } => {
  const estimatedBytesPerItem = 120; // Estimativa conservadora
  const maxItems = Math.floor(maxBytes / estimatedBytesPerItem);
  return {
    valid: itemsCount <= maxItems,
    maxItems,
  };
};

// ============ COLOR DETECTION ============

/**
 * Detecta cores no nome do arquivo
 */
export const detectColors = (filename: string): ColorDetection => {
  if (!filename || typeof filename !== 'string') {
    return { colors: [], gameCount: 1 };
  }

  const filenameLower = filename.toLowerCase();

  const patterns = [
    { regex: /\bcmyk\b/, name: 'CMYK', games: 4 },
    { regex: /\b(\d{3,5})c\b/, name: 'PANTONE', games: 1 },
    { regex: /\bgray[1-4]\b/, name: 'GRAY', games: 1 },
    { regex: /\b(black|preto|pb|p&b)\b/, name: 'BLACK', games: 1 },
    { regex: /\b(white|branco)\b/, name: 'WHITE', games: 1 },
    { regex: /\bred\b/, name: 'RED', games: 1 },
    { regex: /\bblue\b/, name: 'BLUE', games: 1 },
  ];

  const detected: string[] = [];
  let totalGames = 0;

  for (const { regex, name, games } of patterns) {
    if (regex.test(filenameLower)) {
      detected.push(name);
      totalGames += games;
    }
  }

  return {
    colors: detected.length > 0 ? detected : [],
    gameCount: Math.max(1, totalGames),
  };
};

// ============ FILENAME PARSING ============

/**
 * Extrai OS (Ordem de Serviço) do nome do arquivo
 */
export const extractOS = (filename: string): string => {
  if (!filename) return '';
  const osMatch = filename.match(/\b(\d{4,})\b/);
  return osMatch ? osMatch[1] : '';
};

/**
 * Extrai dimensões do nome do arquivo (ex: 100x200mm)
 */
export const extractDimensions = (filename: string): Omit<PdfDimensions, 'source'> | null => {
  if (!filename) return null;

  // Padrão: 100x200mm ou 100X200mm
  const sizeMatch = filename.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm/i);

  if (!sizeMatch) return null;

  const widthMm = parseFloat(sizeMatch[1]);
  const heightMm = parseFloat(sizeMatch[2]);

  // Converter mm para cm
  const widthCm = parseFloat((widthMm / 10).toFixed(2));
  const heightCm = parseFloat((heightMm / 10).toFixed(2));

  const validation = validateDimensions(widthCm, heightCm);
  if (!validation.valid) {
    logger.warn(`Invalid dimensions extracted from filename: ${widthCm}x${heightCm}cm`, { filename });
    return null;
  }

  return { width: widthCm, height: heightCm };
};

/**
 * Calcula dimensões a partir de PDF page geometry
 */
export const calculatePdfDimensions = (pageWidth: number, pageHeight: number, marginCm: number = 1): Omit<PdfDimensions, 'source'> => {
  // 1 point = 1/72 inch; 1 inch = 2.54 cm
  // Formula: points * (2.54 / 72)
  const widthCm = (pageWidth * 2.54) / 72;
  const heightCm = (pageHeight * 2.54) / 72;

  // Adiciona margem (em cm)
  const finalWidth = parseFloat((widthCm + marginCm * 2).toFixed(2));
  const finalHeight = parseFloat((heightCm + marginCm * 2).toFixed(2));

  return { width: finalWidth, height: finalHeight };
};

// ============ PDF WORKER SETUP ============

const WORKER_URLS = [
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
];

let blobUrl: string | null = null;

/**
 * Inicializa PDF.js worker com fallback para múltiplas URLs
 */
export const initPdfWorker = async (retryCount: number = 0): Promise<boolean> => {
  if (typeof window === 'undefined') return false;

  const pdfjs = (pdfjsLib as any).default || pdfjsLib;

  if (!pdfjs.GlobalWorkerOptions) return false;
  if (pdfjs.GlobalWorkerOptions.workerSrc) {
    logger.debug('PDF worker already initialized');
    return true;
  }

  // Tentar cada URL
  for (const url of WORKER_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn(`PDF worker fetch returned status ${response.status}`, { url });
        continue;
      }

      const workerScript = await response.text();
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      pdfjs.GlobalWorkerOptions.workerSrc = blobUrl;

      logger.info('✅ PDF worker initialized successfully from blob', { url });
      return true;
    } catch (error) {
      logger.warn(`Failed to load PDF worker from ${url}`, error);
      continue;
    }
  }

  // Final fallback (pode ter CORS issues)
  logger.warn('⚠️ Using CDN URL for PDF worker as fallback (may have CORS issues)', {
    url: WORKER_URLS[0],
  });
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URLS[0];
  return false;
};

/**
 * Limpa referência de blob URL do worker
 */
export const cleanupPdfWorker = (): void => {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    logger.debug('PDF worker blob URL revoked');
  }
};

// ============ LOCALSTORAGE HELPERS ============

/**
 * Carrega dados do localStorage com error handling e recovery
 */
export const loadFromStorage = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;

  try {
    const saved = localStorage.getItem(key);
    if (!saved) return defaultValue;

    const parsed = JSON.parse(saved);
    return parsed || defaultValue;
  } catch (error) {
    logger.error(`Failed to load data from localStorage (key: ${key})`, error);
    
    // Tentar limpar dados corrompidos
    try {
      localStorage.removeItem(key);
      logger.info(`Removed corrupted data from localStorage (key: ${key})`);
    } catch (removeError) {
      logger.error(`Failed to remove corrupted data from localStorage`, removeError);
    }

    return defaultValue;
  }
};

/**
 * Salva dados no localStorage com error handling
 */
export const saveToStorage = (key: string, data: any): { success: boolean; error?: string } => {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Window is not defined' };
  }

  try {
    const serialized = JSON.stringify(data);
    localStorage.setItem(key, serialized);
    logger.debug(`Data saved to localStorage (key: ${key})`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to save data to localStorage (key: ${key})`, error);
    return { success: false, error: errorMessage };
  }
};

// ============ DATA MIGRATION ============

/**
 * Migra dados legados com fallbacks para novos campos
 */
export const migrateOrderItem = (item: any): OrderItem => {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid order item');
  }

  return {
    id: item.id || Math.random().toString(36).substr(2, 9),
    os: String(item.os || ''),
    clientDescription: String(item.clientDescription || ''),
    colors: String(item.colors || ''),
    jobType: (item.jobType || 'Novo') as 'Novo' | 'Reimpressão' | 'Ajuste',
    date: item.date || new Date().toISOString().split('T')[0],
    width: parseFloat(item.width) || 0,
    height: parseFloat(item.height) || 0,
    games: validateGames(item.games),
    pricePerCm2: parseFloat(item.pricePerCm2) || 0.0798,
    observations: String(item.observations || ''),
  };
};

/**
 * Migra batch histórico com validação completa
 */
export const migrateHistoryBatch = (batch: any): any => {
  if (!batch || typeof batch !== 'object') {
    throw new Error('Invalid history batch');
  }

  return {
    ...batch,
    items: (batch.items || []).map((item: any) => {
      try {
        return migrateOrderItem(item);
      } catch (error) {
        logger.warn('Failed to migrate history batch item', error);
        return null;
      }
    }).filter((item: any) => item !== null),
  };
};