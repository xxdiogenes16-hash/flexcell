/**
 * PDF service for FlexCell NX 1.14
 * Handles PDF import/export with advanced parsing
 */

import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import pptxgen from 'pptxgenjs';
import {
  OrderItem,
  CalculatedItem,
  HistoryBatch,
} from './types';
import {
  logger,
  extractOS,
  extractDimensions,
  calculatePdfDimensions,
  detectColors,
  validateDimensions,
  validateGames,
  migrateOrderItem,
} from './utils';

const pdfjs: any = (pdfjsLib as any).default || pdfjsLib;
const DEFAULT_RATE = 0.0798;

interface PdfImportResult {
  success: boolean;
  itemsCreated: number;
  filesProcessed: number;
  filesFailed: number;
  errors: string[];
  items: OrderItem[];
}

/**
 * Importa PDFs e cria OrderItems
 */
export const importPdfsToItems = async (
  files: FileList,
  onProgress?: (current: number, total: number) => void
): Promise<PdfImportResult> => {
  const result: PdfImportResult = {
    success: true,
    itemsCreated: 0,
    filesProcessed: 0,
    filesFailed: 0,
    errors: [],
    items: [],
  };

  if (!files || files.length === 0) {
    result.success = false;
    result.errors.push('Nenhum arquivo selecionado');
    return result;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      onProgress?.(i + 1, files.length);

      if (!file.name.toLowerCase().endsWith('.pdf')) {
        logger.warn(`Skipping non-PDF file: ${file.name}`);
        continue;
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument(arrayBuffer).promise;

      const fileNameBase = file.name.replace(/\.pdf$/i, '');
      const fileOS = extractOS(file.name);
      const dimsFromFilename = extractDimensions(file.name);
      const colorDetection = detectColors(file.name);

      logger.debug(`Processing PDF: ${file.name}`, {
        os: fileOS,
        colors: colorDetection.colors,
        dimensionsFromFilename: dimsFromFilename ? 'found' : 'not found',
      });

      // Processar cada página
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);

          let finalWidth: number;
          let finalHeight: number;
          let obs: string;

          if (dimsFromFilename) {
            // Prioridade: dimensões do nome do arquivo
            finalWidth = dimsFromFilename.width;
            finalHeight = dimsFromFilename.height;
            obs = 'Dimensões extraídas do nome do arquivo';
          } else {
            // Fallback: geometria da página PDF
            const viewport = page.getViewport({ scale: 1.0 });
            const dimResult = calculatePdfDimensions(viewport.width, viewport.height, 1);
            finalWidth = dimResult.width;
            finalHeight = dimResult.height;
            obs = 'Importado de PDF (+1cm margem/lado)';
          }

          // Validar dimensões
          const dimValidation = validateDimensions(finalWidth, finalHeight);
          if (!dimValidation.valid) {
            logger.warn(`Invalid dimensions for page ${pageNum} in ${file.name}`, {
              width: finalWidth,
              height: finalHeight,
              error: dimValidation.error,
            });
            result.errors.push(`${file.name} (página ${pageNum}): ${dimValidation.error}`);
            continue;
          }

          const description = `${fileNameBase}${pdf.numPages > 1 ? ` - Pág ${pageNum}` : ''}`;

          const newItem: OrderItem = {
            id: Math.random().toString(36).substr(2, 9),
            os: fileOS,
            clientDescription: description,
            colors: colorDetection.colors.join(', '),
            jobType: 'Novo',
            date: new Date().toISOString().split('T')[0],
            width: finalWidth,
            height: finalHeight,
            games: colorDetection.gameCount,
            pricePerCm2: DEFAULT_RATE,
            observations: obs,
          };

          result.items.push(migrateOrderItem(newItem));
          result.itemsCreated++;
        } catch (pageError) {
          const errorMsg = pageError instanceof Error ? pageError.message : String(pageError);
          logger.error(`Failed to process page ${pageNum} of ${file.name}`, pageError);
          result.errors.push(`${file.name} (página ${pageNum}): ${errorMsg}`);
        }
      }

      result.filesProcessed++;
    } catch (fileError) {
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      logger.error(`Failed to process PDF file: ${file.name}`, fileError);
      result.errors.push(`${file.name}: ${errorMsg}`);
      result.filesFailed++;
      result.success = false;
    }
  }

  logger.info('PDF import completed', {
    filesProcessed: result.filesProcessed,
    itemsCreated: result.itemsCreated,
    errors: result.errors.length,
  });

  return result;
};

/**
 * Exporta para PDF com formatação
 */
export const exportToPdf = (
  items: CalculatedItem[],
  totalStock: number,
  fixedCost: number,
  isProduction: boolean,
  history: HistoryBatch[] = []
): void => {
  try {
    const doc = new jsPDF('l'); // Landscape
    const dateStr = new Date().toLocaleDateString('pt-BR');

    // Header
    doc.setFontSize(16);
    doc.text(
      `Relatório de Produção - ${isProduction ? 'Atual' : 'Histórico'}`,
      14,
      15
    );
    doc.setFontSize(10);
    doc.text(`Gerado em: ${dateStr} | FlexCell NX 1.14`, 14, 22);

    const columns = [
      { header: 'OS', dataKey: 'os' },
      { header: 'Cliente', dataKey: 'client' },
      { header: 'Cores', dataKey: 'colors' },
      { header: 'Tipo', dataKey: 'type' },
      { header: 'Data', dataKey: 'date' },
      { header: 'Larg', dataKey: 'w' },
      { header: 'Alt', dataKey: 'h' },
      { header: 'Qtd. Jogos', dataKey: 'games' },
      { header: 'Total CM2', dataKey: 'cm2' },
      { header: 'Valor($)', dataKey: 'val' },
      { header: 'Obs', dataKey: 'obs' },
    ];

    let tableData: any[] = [];

    if (isProduction) {
      tableData = items.map((item) => ({
        os: item.os,
        client: item.clientDescription,
        colors: item.colors || '-',
        type: item.jobType || 'Novo',
        date: new Date(item.date).toLocaleDateString('pt-BR'),
        w: item.width,
        h: item.height,
        games: item.games || 1,
        cm2: item.cm2Total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        val: item.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        obs: item.observations || '',
      }));

      autoTable(doc, {
        head: [columns.map((c) => c.header)],
        body: tableData.map((r) => columns.map((c) => r[c.dataKey])),
        startY: 30,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: {
          obs: { cellWidth: 20 },
          colors: { cellWidth: 25 },
        },
      });

      // Summary
      const totalCm2 = items.reduce((acc, i) => acc + i.cm2Total, 0);
      const totalItemsValue = items.reduce((acc, i) => acc + i.totalValue, 0);
      const finalTotal = totalItemsValue + fixedCost;

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumo Financeiro', 14, finalY);

      doc.setFont('helvetica', 'normal');
      doc.text(
        `Estoque Inicial: ${totalStock} cm²`,
        14,
        finalY + 6
      );
      doc.text(
        `Total Consumido: ${totalCm2.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} cm²`,
        14,
        finalY + 12
      );
      doc.text(
        `Estoque Restante: ${(totalStock - totalCm2).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} cm²`,
        14,
        finalY + 18
      );

      doc.text(
        `Total Itens: ${totalItemsValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        100,
        finalY + 6
      );
      doc.text(
        `Custo Fixo: ${fixedCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        100,
        finalY + 12
      );

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `TOTAL GERAL: ${finalTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        100,
        finalY + 20
      );
    } else {
      // History view
      const histColumns = [{ header: 'Lote', dataKey: 'batch' }, ...columns];

      tableData = items.map((item) => ({
        batch: new Date(item.date).toLocaleDateString('pt-BR'),
        os: item.os,
        client: item.clientDescription,
        colors: item.colors || '-',
        type: item.jobType || 'Novo',
        date: new Date(item.date).toLocaleDateString('pt-BR'),
        w: item.width,
        h: item.height,
        games: item.games || 1,
        cm2: item.cm2Total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        val: item.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        obs: item.observations || '',
      }));

      autoTable(doc, {
        head: [histColumns.map((c) => c.header)],
        body: tableData.map((r) => histColumns.map((c) => r[c.dataKey])),
        startY: 30,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [59, 130, 246] },
      });

      const grandTotal = items.reduce((acc, i) => acc + i.totalValue, 0);
      const finalY = (doc as any).lastAutoTable.finalY + 10;

      doc.setFontSize(10);
      doc.text(
        `Total Acumulado: ${grandTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        14,
        finalY
      );
    }

    doc.save(
      `FlexCell_Relatorio_${activeTab}_${new Date().toISOString().slice(0, 10)}.pdf`
    );
    logger.info('PDF exported successfully');
  } catch (error) {
    logger.error('Failed to export PDF', error);
    throw error;
  }
};

/**
 * Exporta para PowerPoint
 */
export const exportToPpt = (
  items: CalculatedItem[],
  isProduction: boolean
): void => {
  try {
    const pres = new pptxgen();
    const dateStr = new Date().toLocaleDateString('pt-BR');

    const slide = pres.addSlide();
    slide.addText(
      `Relatório de Produção - ${isProduction ? 'Atual' : 'Histórico'}`,
      {
        x: 0.5,
        y: 0.5,
        fontSize: 18,
        bold: true,
        color: '363636',
      }
    );
    slide.addText(`Gerado em: ${dateStr}`, {
      x: 0.5,
      y: 0.8,
      fontSize: 11,
      color: '808080',
    });

    const headers = ['OS', 'CLIENTE', 'CORES', 'DATA', 'CM2', 'VALOR', 'LARG'];
    const tableRows = items.map((item) => [
      item.os,
      item.clientDescription,
      item.colors || '-',
      new Date(item.date).toLocaleDateString('pt-BR'),
      item.cm2Total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      item.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      item.width.toString(),
    ]);

    if (tableRows.length > 0) {
      slide.addTable([headers, ...tableRows], {
        x: 0.5,
        y: 1.2,
        w: '95%',
        fontSize: 10,
        border: { pt: 1, color: 'e1e1e1' },
        fill: { color: 'ffffff' },
        headerStyles: { fill: { color: '3b82f6' }, color: 'ffffff', bold: true },
      });
    } else {
      slide.addText('Nenhum item encontrado.', {
        x: 0.5,
        y: 2.0,
        color: 'cc0000',
      });
    }

    pres.writeFile({
      fileName: `FlexCell_Relatorio_${new Date().toISOString().slice(0, 10)}.pptx`,
    });
    logger.info('PowerPoint exported successfully');
  } catch (error) {
    logger.error('Failed to export PowerPoint', error);
    throw error;
  }
};