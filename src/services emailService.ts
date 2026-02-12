/**
 * Email service for FlexCell NX 1.14
 * Handles EmailJS integration with batch support and error handling
 */

import emailjs from '@emailjs/browser';
import { OrderItem, EmailSettings } from './types';
import { logger, validateEmail, validateEmailSize } from './utils';

const MAX_EMAIL_SIZE_BYTES = 4000;
const ESTIMATED_BYTES_PER_ITEM = 120;

interface EmailBatch {
  items: OrderItem[];
  batchNumber: number;
  totalBatches: number;
}

/**
 * Formata item para display em email
 */
const formatItemForEmail = (item: OrderItem, index: number): string => {
  return `${index}. OS: ${item.os} | ${item.clientDescription} | Cores: ${item.colors || 'N/A'} | Dim: ${item.width}x${item.height}cm`;
};

/**
 * Divide items em batches respeitando limite de tamanho
 */
export const splitIntoEmailBatches = (items: OrderItem[]): EmailBatch[] => {
  const batches: EmailBatch[] = [];
  let currentBatch: OrderItem[] = [];
  let currentSize = 0;

  for (const item of items) {
    const itemStr = formatItemForEmail(item, 1);
    const itemSize = Buffer.byteLength(itemStr, 'utf8');

    if (currentSize + itemSize > MAX_EMAIL_SIZE_BYTES && currentBatch.length > 0) {
      batches.push({
        items: currentBatch,
        batchNumber: batches.length + 1,
        totalBatches: 0, // Será preenchido depois
      });
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(item);
    currentSize += itemSize;
  }

  if (currentBatch.length > 0) {
    batches.push({
      items: currentBatch,
      batchNumber: batches.length + 1,
      totalBatches: 0, // Será preenchido depois
    });
  }

  // Preencher totalBatches
  const totalBatches = batches.length;
  batches.forEach((batch) => {
    batch.totalBatches = totalBatches;
  });

  return batches;
};

/**
 * Formata mensagem de email para um batch
 */
const formatEmailMessage = (batch: EmailBatch): string => {
  const header = `Batch ${batch.batchNumber}/${batch.totalBatches} - ${batch.items.length} itens\n${'='.repeat(60)}\n\n`;
  const items = batch.items
    .map((item, idx) => formatItemForEmail(item, idx + 1))
    .join('\n');
  return header + items;
};

/**
 * Envia notificação em lote via EmailJS
 */
export const sendBatchNotification = async (
  items: OrderItem[],
  settings: EmailSettings,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: boolean; sent: number; failed: number; errors: string[] }> => {
  const result = {
    success: true,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Validações
  if (!settings.enabled) {
    logger.info('Email notifications are disabled');
    return result;
  }

  if (!validateEmail(settings.targetEmail)) {
    const error = 'Email inválido: ' + settings.targetEmail;
    logger.error(error);
    result.errors.push(error);
    result.success = false;
    return result;
  }

  if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
    const error = 'Configurações de email incompletas';
    logger.error(error);
    result.errors.push(error);
    result.success = false;
    return result;
  }

  if (items.length === 0) {
    logger.info('No items to send via email');
    return result;
  }

  // Dividir em batches
  const batches = splitIntoEmailBatches(items);
  logger.info(`Sending email notifications in ${batches.length} batch(es)`, {
    totalItems: items.length,
    batchCount: batches.length,
  });

  // Enviar cada batch
  for (const batch of batches) {
    try {
      const message = formatEmailMessage(batch);

      const params = {
        to_email: settings.targetEmail,
        message,
        subject: `FlexCell: Importação em Lote - Batch ${batch.batchNumber}/${batch.totalBatches}`,
      };

      await emailjs.send(
        settings.serviceId,
        settings.templateId,
        params,
        settings.publicKey
      );

      result.sent += batch.items.length;
      logger.info(`Email batch ${batch.batchNumber}/${batch.totalBatches} sent successfully`, {
        itemCount: batch.items.length,
      });

      onProgress?.(batch.batchNumber, batches.length);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send email batch ${batch.batchNumber}/${batch.totalBatches}`, error);
      result.errors.push(`Batch ${batch.batchNumber}: ${errorMessage}`);
      result.failed += batch.items.length;
      result.success = false;
    }
  }

  return result;
};

/**
 * Envia email único (sem batch)
 */
export const sendSingleEmail = async (
  to: string,
  subject: string,
  message: string,
  settings: EmailSettings
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!validateEmail(to)) {
      return { success: false, error: 'Email inválido' };
    }

    if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
      return { success: false, error: 'Configurações de email incompletas' };
    }

    await emailjs.send(
      settings.serviceId,
      settings.templateId,
      {
        to_email: to,
        subject,
        message,
      },
      settings.publicKey
    );

    logger.info('Email sent successfully', { to, subject });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to send email', error);
    return { success: false, error: errorMessage };
  }
};