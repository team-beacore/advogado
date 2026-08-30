import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import {
  Button, SecondaryButton, Input, Select, Card, Badge, EmptyState, ErrorAlert, Modal,
  formatDate, statusColor, statusLabel,
} from '../components/ui';

interface Contract { id: string; title: string; status: string; total_value: string; client_name: string | null; created_at: string; }
interface Invoice { id: string; description: string; amount: string; status: string; due_date: string | null; contract_title: string | null; client_name: string | null; paid_amount: string; installment_count: number; }
interface InvoiceDetail extends Invoice { installments: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>>; }
interface Summary { receivable: { total: number; count: number }; received: { total: number; count: number }; byStatus: Array<{ status: string; count: number; total: number }>; }

function currency(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Finance() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<InvoiceDetail | null>(null);
  const [showContract, setShowContract] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [contractForm, setContractForm] = useState({ clientId: '', title: '', totalValue: '', status: 'DRAFT' });
  const [invoiceForm, setInvoiceForm] = useState({ contractId: '', description: '', amount: '', installmentCount: '1', dueDate: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, i, s] = await Promise.all([
        apiGet<{ items: Contract[] }>('/api/finance/contracts'),
        apiGet<{ items: Invoice[] }>('/api/finance/invoices'),
        apiGet<Summary>('/api/finance/summary'),
      ]);
      setContracts(c.items);
      setInvoices(i.items);
      setSummary(s);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void apiGet<{ items: Array<{ id: string; name: string }> }>('/api/clients').then((r) => setClients(r.items)).catch(() => {});
  }, []);

  const createContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/finance/contracts', {
        clientId: contractForm.clientId || null,
        title: contractForm.title,
        totalValue: Number(contractForm.totalValue) || 0,
        status: contractForm.status,
      });
      setShowContract(false);
      setContractForm({ clientId: '', title: '', totalValue: '', status: 'DRAFT' });
      void load();
    } catch (err) { setFormError(err); }
  };

  const createInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/finance/invoices', {
        contractId: invoiceForm.contractId || null,
        description: invoiceForm.description,
        amount: Number(invoiceForm.amount) || 0,
        installmentCount: Number(invoiceForm.installmentCount) || 1,
        dueDate: invoiceForm.dueDate ? new Date(invoiceForm.dueDate).toISOString() : null,
      });
      setShowInvoice(false);
      setInvoiceForm({ contractId: '', description: '', amount: '', installmentCount: '1', dueDate: '' });
      void load();
    } catch (err) { setFormError(err); }
  };

  const openInvoice = async (id: string) => {
    try {
      const detail = await apiGet<InvoiceDetail>(`/api/finance/invoices/${id}`);
      setSelected(detail);
    } catch (err) { setFormError(err); }
  };

  const markPaid = async (invoiceId: string) => {
    try {
      const detail = await apiGet<InvoiceDetail>(`/api/finance/invoices/${invoiceId}`);
      await apiPost('/api/finance/payments', { invoiceId, amount: Number(detail.amount), method: 'PIX' });
      setSelected(null);
      void load();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Financeiro</h1>
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setShowContract(true)}>Novo contrato</SecondaryButton>
          <Button onClick={() => setShowInvoice(true)}>Nova cobrança</Button>
        </div>
      </div>

      <ErrorAlert error={error} />

      {summary && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title="A receber">
            <div className="text-2xl font-bold">{currency(summary.receivable.total)}</div>
            <div className="text-xs text-gray-500">{summary.receivable.count} cobrança(s) pendente(s)</div>
          </Card>
          <Card title="Recebido">
            <div className="text-2xl font-bold text-green-600">{currency(summary.received.total)}</div>
            <div className="text-xs text-gray-500">{summary.received.count} pagamento(s)</div>
          </Card>
          <Card title="Status das cobranças">
            <ul className="space-y-1 text-sm">
              {summary.byStatus.map((s) => (
                <li key={s.status} className="flex justify-between">
                  <span>{statusLabel(s.status)}</span>
                  <b>{s.count}</b>
                </li>
              ))}
              {summary.byStatus.length === 0 && <li className="text-gray-400">Nenhuma</li>}
            </ul>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={`Contratos (${contracts.length})`}>
            {contracts.length === 0 ? (
              <EmptyState title="Nenhum contrato." hint="Crie um contrato para gerar cobranças." />
            ) : (
              <ul className="space-y-2">
                {contracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{c.title}</div>
                      <div className="text-xs text-gray-500">{c.client_name ?? 'Sem cliente'} · {currency(c.total_value)}</div>
                    </div>
                    <Badge color={statusColor(c.status)}>{statusLabel(c.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Cobranças (${invoices.length})`}>
            {invoices.length === 0 ? (
              <EmptyState title="Nenhuma cobrança." hint="Crie uma cobrança para faturar um contrato." />
            ) : (
              <ul className="space-y-2">
                {invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{i.description}</div>
                      <div className="text-xs text-gray-500">
                        {i.contract_title ?? 'Avulsa'} · {currency(i.amount)}
                        {i.installment_count > 1 && <span> · {i.installment_count}×</span>}
                        {i.due_date && <span> · vence {formatDate(i.due_date)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={statusColor(i.status)}>{statusLabel(i.status)}</Badge>
                      <button onClick={() => openInvoice(i.id)} className="text-brand-600 hover:underline">Detalhes</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Modal open={showContract} onClose={() => setShowContract(false)} title="Novo contrato">
        <form onSubmit={createContract} className="space-y-3">
          <ErrorAlert error={formError} />
          <div>
            <label className="mb-1 block text-sm font-medium">Título *</label>
            <Input value={contractForm.title} onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cliente</label>
            <Select value={contractForm.clientId} onChange={(e) => setContractForm({ ...contractForm, clientId: e.target.value })}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Valor total</label>
              <Input type="number" step="0.01" min="0" value={contractForm.totalValue} onChange={(e) => setContractForm({ ...contractForm, totalValue: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Status</label>
              <Select value={contractForm.status} onChange={(e) => setContractForm({ ...contractForm, status: e.target.value })}>
                <option value="DRAFT">Rascunho</option>
                <option value="ACTIVE">Ativo</option>
                <option value="FINISHED">Concluído</option>
                <option value="CANCELLED">Cancelado</option>
              </Select>
            </div>
          </div>
          <Button type="submit" className="w-full">Criar contrato</Button>
        </form>
      </Modal>

      <Modal open={showInvoice} onClose={() => setShowInvoice(false)} title="Nova cobrança">
        <form onSubmit={createInvoice} className="space-y-3">
          <ErrorAlert error={formError} />
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição *</label>
            <Input value={invoiceForm.description} onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Contrato</label>
            <Select value={invoiceForm.contractId} onChange={(e) => setInvoiceForm({ ...invoiceForm, contractId: e.target.value })}>
              <option value="">Cobrança avulsa</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Valor</label>
              <Input type="number" step="0.01" min="0" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Parcelas</label>
              <Input type="number" min="1" value={invoiceForm.installmentCount} onChange={(e) => setInvoiceForm({ ...invoiceForm, installmentCount: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Vencimento</label>
            <Input type="datetime-local" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar cobrança</Button>
        </form>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Detalhes da cobrança">
        {selected && (
          <div className="space-y-4">
            <ErrorAlert error={formError} />
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{selected.description}</div>
              <Badge color={statusColor(selected.status)}>{statusLabel(selected.status)}</Badge>
            </div>
            <div className="text-sm text-gray-500">Valor: <b>{currency(selected.amount)}</b></div>
            <div>
              <div className="mb-2 text-sm font-medium">Parcelas</div>
              {selected.installments.length === 0 ? (
                <div className="text-sm text-gray-400">Nenhuma parcela.</div>
              ) : (
                <ul className="space-y-1">
                  {selected.installments.map((ins) => (
                    <li key={String(ins.id)} className="flex items-center justify-between rounded border border-gray-100 px-3 py-1.5 text-sm">
                      <span>Parcela {String(ins.number)} · {formatDate(String(ins.due_date))}</span>
                      <div className="flex items-center gap-2">
                        <span>{currency(String(ins.amount))}</span>
                        <Badge color={statusColor(String(ins.status))}>{statusLabel(String(ins.status))}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selected.status !== 'PAID' && (
              <Button onClick={() => markPaid(selected.id)} className="w-full">Registrar pagamento (PIX)</Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}