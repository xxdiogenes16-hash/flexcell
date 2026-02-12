/**
 * Type definitions for FlexCell NX 1.14
 */

export interface OrderItem {
  id: string;
  os: string;
  clientDescription: string;
  colors: string;
  jobType: 'Novo' | 'Reimpressão' | 'Ajuste';
  date: string;
  width: number;
  height: number;
  games: number;
  pricePerCm2: number;
  observations: string;
}

export interface CalculatedItem extends OrderItem {
  cm2Total: number;
  totalValue: number;
}

export interface HistoryBatch {
  id: string;
  timestamp: string;
  items: OrderItem[];
  stockSnapshot: number;
  month: number;
  year: number;
}

export interface EmailSettings {
  serviceId: string;
  templateId: string;
  publicKey: string;
  targetEmail: string;
  enabled: boolean;
}

export interface ColorDetection {
  colors: string[];
  gameCount: number;
}

export interface PdfDimensions {
  width: number;
  height: number;
  source: 'filename' | 'pdf' | 'default';
}