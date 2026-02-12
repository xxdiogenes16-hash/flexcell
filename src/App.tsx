/**
 * FlexCell NX 1.14 - Production Management App
 * Refactored with improved error handling, validation, and modular services
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Printer,
  Save,
  Archive,
  LayoutList,
  History as HistoryIcon,
  CheckCircle2,
  FileText,
  Presentation,
  Settings,
  Mail,
} from 'lucide-react';

import { OrderItem, HistoryBatch, EmailSettings, CalculatedItem } from './types';
import {
  logger,
  loadFromStorage,
  saveToStorage,
  migrateOrderItem,
  migrateHistoryBatch,
  initPdfWorker,
  cleanupPdfWorker,
} from './utils';
import { importPdfsToItems, exportToPdf, exportToPpt } from './services/pdfService';
import { sendBatchNotification } from './services/emailService';
import { OrderTable } from './components/OrderTable';
import { Summary } from './components/Summary';
import { HistoryView } from './components/HistoryView';
import { EmailSettingsModal } from './components/EmailSettingsModal';

// Constants
const DEFAULT_RATE = 0.0798;
const STORAGE_KEY = 'flexcell_calculator_data';
const HISTORY_KEY = 'flexcell_history_data';
const EMAIL_SETTINGS_KEY = 'flexcell_email_settings';
const AUTO_SAVE_INTERVAL = 2 * 60 * 1000; // 2 minutes

const INITIAL_DATA: OrderItem[] = [
  {
    id: '1',
    os: '4787',
    clientDescription: '16293 - Alibem',
    colors: 'CMYK',
    jobType: 'Novo',
    date: '2023-11-27',
    width: 18.0,
    height: 24.0,
    games: 4,
    pricePerCm2: DEFAULT_RATE,
    observations: '',
  },
  {
    id: '2',
    os: '4777',
    clientDescription: '16293 - SIF',
    colors: 'Pantone 485C',
    jobType: 'Novo',
    date: '2023-11-27',
    width: 18.0,
    height: 24.0,
    games: 1,
    pricePerCm2: DEFAULT_RATE,
    observations: '',
  },
  {
    id: '3',
    os: '4578',
    clientDescription: '69853 - Pinheirense',
    colors: 'Black',
    jobType: 'Novo',
    date: '2023-11-25',
    width: 18.0,
    height: 24.0,
    games: 1,
    pricePerCm2: DEFAULT_RATE,
    observations: '',
  },
];

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  serviceId: '',
  templateId: '',
  publicKey: '',
  targetEmail: '',
  enabled: false,
};

/**
 * Calcula cm2 total e valor de um item
 */
const calculateItem = (item: OrderItem): CalculatedItem => {
  const cm2Total = item.width * item.height * item.games;
  const totalValue = cm2Total * item.pricePerCm2;
  return {
    ...item,
    cm2Total,
    totalValue,
  };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'production' | 'history'>('production');
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [historyIsDirty, setHistoryIsDirty] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Email settings
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(() =>
    loadFromStorage(EMAIL_SETTINGS_KEY, DEFAULT_EMAIL_SETTINGS)
  );

  // Items state with safe loading
  const [items, setItems] = useState<OrderItem[]>(() => {
    const saved = loadFromStorage<any>(STORAGE_KEY, null);
    if (saved?.items && Array.isArray(saved.items)) {
      return saved.items
        .map((item: any) => {
          try {
            return migrateOrderItem(item);
          } catch (error) {
            logger.warn('Failed to migrate order item', error);
            return null;
          }
        })
        .filter((item: any) => item !== null);
    }
    return INITIAL_DATA;
  });

  // Stock state
  const [totalStock, setTotalStock] = useState<number>(() => {
    const saved = loadFromStorage<any>(STORAGE_KEY, null);
    return typeof saved?.totalStock === 'number' ? saved.totalStock : 10000;
  });

  // Fixed cost state
  const [fixedCost, setFixedCost] = useState<number>(() => {
    const saved = loadFromStorage<any>(STORAGE_KEY, null);
    return typeof saved?.fixedCost === 'number' ? saved.fixedCost : 0;
  });

  // History state with safe loading
  const [history, setHistory] = useState<HistoryBatch[]>(() => {
    const saved = loadFromStorage<any[]>(HISTORY_KEY, []);
    return saved
      .map((batch: any) => {
        try {
          return migrateHistoryBatch(batch);
        } catch (error) {
          logger.warn('Failed to migrate history batch', error);
          return null;
        }
      })
      .filter((batch: any) => batch !== null);
  });

  // Refs for auto-save closure
  const itemsRef = useRef(items);
  const stockRef = useRef(totalStock);
  const fixedCostRef = useRef(fixedCost);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    stockRef.current = totalStock;
  }, [totalStock]);

  useEffect(() => {
    fixedCostRef.current = fixedCost;
  }, [fixedCost]);

  // Initialize PDF worker on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initPdfWorker();
      } catch (error) {
        logger.error('Failed to initialize PDF worker', error);
      }
    };
    init();

    // Cleanup on unmount
    return () => {
      cleanupPdfWorker();
    };
  }, []);

  // Auto-save interval
  useEffect(() => {
    const intervalId = setInterval(() => {
      const saveResult = saveData(itemsRef.current, stockRef.current, fixedCostRef.current, true);
      if (saveResult.success) {
        setLastAutoSave(new Date());
        setTimeout(() => setLastAutoSave(null), 3000);
      }
    }, AUTO_SAVE_INTERVAL);

    return () => clearInterval(intervalId);
  }, []);

  // History auto-save
  useEffect(() => {
    const saveResult = saveToStorage(HISTORY_KEY, history);
    if (!saveResult.success) {
      logger.error('Failed to auto-save history', { error: saveResult.error });
    }
  }, [history]);

  // Warn on page close if history is dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (historyIsDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [historyIsDirty]);

  // ============ HANDLERS ============

  const saveData = (
    currentItems = items,
    currentStock = totalStock,
    currentFixed = fixedCost,
    isAuto = false
  ): { success: boolean; error?: string } => {
    try {
      const dataToSave = {
        items: currentItems,
        totalStock: currentStock,
        fixedCost: currentFixed,
      };

      const result = saveToStorage(STORAGE_KEY, dataToSave);

      if (!result.success) {
        logger.error('Failed to save data', result.error);
        if (!isAuto) {
          alert(`❌ Erro ao salvar: ${result.error}`);
        }
        return result;
      }

      logger.info(`Data saved successfully (auto: ${isAuto})`);

      if (!isAuto) {
        alert('✅ Dados salvos com sucesso!');
      }

      return result;
    } catch (error) {
      logger.error('Unexpected error during save', error);
      return { success: false, error: 'Erro inesperado ao salvar' };
    }
  };

  const handleSaveEmailSettings = useCallback((newSettings: EmailSettings) => {
    setEmailSettings(newSettings);
    const result = saveToStorage(EMAIL_SETTINGS_KEY, newSettings);
    if (result.success) {
      logger.info('Email settings saved successfully');
      alert('✅ Configurações de email salvas!');
    } else {
      logger.error('Failed to save email settings', result.error);
      alert(`❌ Erro ao salvar configurações: ${result.error}`);
    }
  }, []);

  const handleTabChange = (tab: 'production' | 'history') => {
    if (historyIsDirty && tab !== 'history') {
      if (
        !window.confirm('Você tem alterações não salvas no histórico. Deseja sair sem salvar?')
      ) {
        return;
      }
      setHistoryIsDirty(false);
    }
    setActiveTab(tab);
  };

  const handleArchive = useCallback(() => {
    if (items.length === 0) {
      alert('❌ Não há itens para arquivar.');
      return;
    }

    if (
      !window.confirm(
        'Isso irá mover todos os itens atuais para o Histórico e limpar a tela de produção. Deseja continuar?'
      )
    ) {
      return;
    }

    try {
      const now = new Date();
      const newBatch: HistoryBatch = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: now.toISOString(),
        items: [...items],
        stockSnapshot: totalStock,
        month: now.getMonth(),
        year: now.getFullYear(),
      };

      setHistory((prev) => [newBatch, ...prev]);
      setItems([]);
      logger.info('Items archived successfully', { batchId: newBatch.id, itemCount: items.length });
      alert('✅ Produção arquivada com sucesso!');
      setActiveTab('history');
    } catch (error) {
      logger.error('Failed to archive items', error);
      alert('❌ Erro ao arquivar produção');
    }
  }, [items, totalStock]);

  const handleRestoreBatches = useCallback((ids: string[]) => {
    const batchesToRestore = history.filter((b) => ids.includes(b.id));
    if (batchesToRestore.length === 0) return;

    const count = batchesToRestore.reduce((acc, b) => acc + b.items.length, 0);

    if (
      window.confirm(
        `Deseja copiar ${count} itens de ${batchesToRestore.length} lote(s) para a produção atual?`
      )
    ) {
      try {
        const newItems = batchesToRestore.flatMap((b) =>
          b.items.map((item) => ({
            ...item,
            id: Math.random().toString(36).substr(2, 9),
          }))
        );
        setItems((prev) => [...prev, ...newItems]);
        logger.info('Items restored successfully', { count, batchCount: batchesToRestore.length });
        alert('✅ Itens restaurados para a aba de Produção.');
        setActiveTab('production');
      } catch (error) {
        logger.error('Failed to restore batches', error);
        alert('❌ Erro ao restaurar itens');
      }
    }
  }, [history]);

  const handleDeleteBatches = useCallback((ids: string[]) => {
    if (
      window.confirm(
        `Tem certeza que deseja apagar ${ids.length} lote(s) do histórico? Esta ação é irreversível.`
      )
    ) {
      try {
        setHistory((prev) => prev.filter((h) => !ids.includes(h.id)));
        logger.info('Batches deleted successfully', { count: ids.length });
      } catch (error) {
        logger.error('Failed to delete batches', error);
        alert('❌ Erro ao apagar lotes');
      }
    }
  }, []);

  const handleSaveBatch = useCallback((updatedBatch: HistoryBatch) => {
    try {
      setHistory((prev) =>
        prev.map((b) => (b.id === updatedBatch.id ? updatedBatch : b))
      );
      logger.info('Batch updated successfully', { batchId: updatedBatch.id });
    } catch (error) {
      logger.error('Failed to save batch', error);
      alert('❌ Erro ao atualizar lote');
    }
  }, []);

  const handleImportPDF = useCallback(
    async (files: FileList) => {
      if (isImporting) {
        alert('⏳ Importação já em andamento. Aguarde...');
        return;
      }

      setIsImporting(true);

      try {
        logger.info('Starting PDF import', { fileCount: files.length });

        const result = await importPdfsToItems(files, (current, total) => {
          logger.debug(`Import progress: ${current}/${total}`);
        });

        if (result.items.length > 0) {
          setItems((prev) => [...prev, ...result.items]);
          logger.info('Items added to production', { count: result.items.length });
        }

        // Display results
        let message = `✅ Importação concluída!\n\n`;
        message += `Arquivos processados: ${result.filesProcessed}\n`;
        message += `Itens criados: ${result.itemsCreated}\n`;
        if (result.filesFailed > 0) {
          message += `Arquivos com erro: ${result.filesFailed}\n`;
        }
        if (result.errors.length > 0) {
          message += `\nErros:\n${result.errors.slice(0, 5).join('\n')}`;
          if (result.errors.length > 5) {
            message += `\n... e mais ${result.errors.length - 5} erros`;
          }
        }

        alert(message);

        // Send email notification if enabled
        if (result.items.length > 0 && emailSettings.enabled) {
          try {
            const emailResult = await sendBatchNotification(result.items, emailSettings);
            if (emailResult.success) {
              logger.info('Email notifications sent', { itemsCount: emailResult.sent });
            } else {
              logger.warn('Email notification had errors', {
                sent: emailResult.sent,
                failed: emailResult.failed,
                errors: emailResult.errors,
              });
            }
          } catch (emailError) {
            logger.error('Failed to send email notifications', emailError);
          }
        }
      } catch (error) {
        logger.error('PDF import failed', error);
        alert('❌ Erro durante importação de PDF. Verifique o console para detalhes.');
      } finally {
        setIsImporting(false);
      }
    },
    [emailSettings]
  );

  const handleExportPDF = useCallback(async () => {
    if (isExporting) {
      alert('⏳ Exportação já em andamento. Aguarde...');
      return;
    }

    setIsExporting(true);

    try {
      const isProduction = activeTab === 'production';
      const itemsToExport = isProduction
        ? items.map(calculateItem)
        : history.flatMap((batch) => batch.items.map(calculateItem));

      logger.info('Starting PDF export', { itemCount: itemsToExport.length });
      await exportToPdf(itemsToExport, totalStock, fixedCost, isProduction, history);
      logger.info('PDF exported successfully');
    } catch (error) {
      logger.error('PDF export failed', error);
      alert('❌ Erro ao exportar PDF. Verifique o console para detalhes.');
    } finally {
      setIsExporting(false);
    }
  }, [activeTab, items, history, totalStock, fixedCost]);

  const handleExportPPT = useCallback(async () => {
    if (isExporting) {
      alert('⏳ Exportação já em andamento. Aguarde...');
      return;
    }

    setIsExporting(true);

    try {
      const isProduction = activeTab === 'production';
      const itemsToExport = isProduction
        ? items.map(calculateItem)
        : history.flatMap((batch) => batch.items.map(calculateItem));

      logger.info('Starting PPT export', { itemCount: itemsToExport.length });
      await exportToPpt(itemsToExport, isProduction);
      logger.info('PPT exported successfully');
    } catch (error) {
      logger.error('PPT export failed', error);
      alert('❌ Erro ao exportar PPT. Verifique o console para detalhes.');
    } finally {
      setIsExporting(false);
    }
  }, [activeTab, items, history]);

  // ============ CRUD ============

  const handleAddItem = useCallback(() => {
    const newItem: OrderItem = {
      id: Math.random().toString(36).substr(2, 9),
      os: '',
      clientDescription: '',
      colors: '',
      jobType: 'Novo',
      date: new Date().toISOString().split('T')[0],
      width: 0,
      height: 0,
      games: 1,
      pricePerCm2: DEFAULT_RATE,
      observations: '',
    };
    setItems((prev) => [...prev, newItem]);
    logger.debug('New item added', { itemId: newItem.id });
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    logger.debug('Item deleted', { itemId: id });
  }, []);

  const handleUpdateItem = useCallback((id: string, field: keyof OrderItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }, []);

  const calculatedItems = items.map(calculateItem);

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
              Relatório de Produção
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-slate-500">Mão de Obra FlexCell NX 1.14 | Equiplan</p>
              {lastAutoSave && (
                <span className="text-xs text-green-600 flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded-full animate-pulse transition-opacity duration-1000">
                  <CheckCircle2 size={12} /> Salvo auto.
                </span>
              )}
              {isImporting && (
                <span className="text-xs text-blue-600 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full animate-pulse">
                  ⏳ Importando...
                </span>
              )}
              {isExporting && (
                <span className="text-xs text-orange-600 flex items-center gap-1 bg-orange-50 px-2 py-0.5 rounded-full animate-pulse">
                  ⏳ Exportando...
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 no-print flex-wrap items-center">
            <button
              onClick={() => setIsEmailModalOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
              disabled={isImporting || isExporting}
              title="Configurar envio automático de e-mail"
            >
              <Settings size={16} />
              Config. Email
            </button>
            {activeTab === 'production' && (
              <>
                <button
                  onClick={handleArchive}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
                  disabled={isImporting || isExporting}
                  title="Move itens atuais para o histórico"
                >
                  <Archive size={16} />
                  Finalizar Mês
                </button>
                <button
                  onClick={() => saveData()}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
                  disabled={isImporting || isExporting}
                >
                  <Save size={16} />
                  Salvar
                </button>
              </>
            )}
            <button
              onClick={handleExportPPT}
              className="flex items-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
              disabled={isImporting || isExporting}
            >
              <Presentation size={16} />
              PPT
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
              disabled={isImporting || isExporting}
            >
              <FileText size={16} />
              PDF
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
              disabled={isImporting || isExporting}
            >
              <Printer size={16} />
              Imprimir
            </button>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="mb-6 border-b border-gray-200 no-print">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => handleTabChange('production')}
              className={`
                whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                ${
                  activeTab === 'production'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <LayoutList size={18} />
              Produção Atual
            </button>
            <button
              onClick={() => handleTabChange('history')}
              className={`
                whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <HistoryIcon size={18} />
              Histórico
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'production' ? (
          <>
            <OrderTable
              items={items}
              onUpdateItem={handleUpdateItem}
              onAddItem={handleAddItem}
              onDeleteItem={handleDeleteItem}
              onImportPDF={handleImportPDF}
              isLoading={isImporting}
            />

            <Summary
              items={calculatedItems}
              totalStock={totalStock}
              onStockChange={setTotalStock}
              fixedCost={fixedCost}
              onFixedCostChange={setFixedCost}
            />

            <div className="mt-8 text-xs text-gray-400 text-center no-print">
              <p>Valores salvos automaticamente a cada 2 minutos.</p>
            </div>
          </>
        ) : (
          <HistoryView
            history={history}
            onSaveBatch={handleSaveBatch}
            onDeleteBatches={handleDeleteBatches}
            onRestoreBatches={handleRestoreBatches}
            onDirtyChange={setHistoryIsDirty}
          />
        )}

        {/* Email Settings Modal */}
        <EmailSettingsModal
          isOpen={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          settings={emailSettings}
          onSave={handleSaveEmailSettings}
        />
      </div>
    </div>
  );
}