import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload, downloadUrl } from '../api/client';
import {
  Button, SecondaryButton, Input, Select, Card, Badge, EmptyState, ErrorAlert, Textarea,
  formatDate, formatDateTime, formatBytes, statusColor, statusLabel, Modal,
} from '../components/ui';
import { FormattedAIOutput } from '../components/FormattedAIOutput';

interface ProcessDetail {
  id: string;
  title: string;
  process_number: string | null;
  court: string | null;
  jurisdiction: string | null;
  area: string | null;
  status: string;
  description: string | null;
  client_name: string | null;
  client_id: string | null;
  responsible_name: string | null;
  responsible_id: string | null;
  last_synced_at: string | null;
  monitoring_status: string | null;
  last_sync_error: string | null;
  monitoring_stale: boolean | null;
  events: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  publications: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
}

interface AiInteraction {
  id: string;
  type: string;
  model: string | null;
  output: { rawText?: string; structured?: Record<string, unknown> | null; disclaimer?: string } | null;
  created_at: string;
  approvals: Array<{ id: string; status: string; reviewed_at: string | null; edited_output: Record<string, unknown> | null }> | null;
}

type Tab = 'visao' | 'timeline' | 'documentos' | 'intimacoes' | 'tarefas' | 'ia' | 'auditoria' | 'sincronizacao';

export default function ProcessDetail() {
  const { id } = useParams();
  const [data, setData] = useState<ProcessDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('visao');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<ProcessDetail>(`/api/processes/${id}`);
      setData(res);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    const res = await apiGet<ProcessDetail>(`/api/processes/${id}`);
    setData(res);
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'visao', label: 'Visão geral' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'documentos', label: `Documentos (${data?.documents.length ?? 0})` },
    { key: 'intimacoes', label: `Intimações (${data?.publications.length ?? 0})` },
    { key: 'tarefas', label: `Tarefas (${data?.tasks.length ?? 0})` },
    { key: 'ia', label: 'IA' },
    { key: 'auditoria', label: 'Auditoria' },
    { key: 'sincronizacao', label: 'Sincronização' },
  ];

  if (loading) return <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-6">
        <Link to="/processos" className="inline-flex items-center gap-1.5 text-sm link-quiet">← Processos</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="page-title">{data.title}</h1>
          <Badge color={statusColor(data.status)}>{statusLabel(data.status)}</Badge>
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {data.process_number && <span className="mr-3">{data.process_number}</span>}
          {data.court && <span className="mr-3">{data.court}</span>}
          {data.area && <span className="mr-3">{data.area}</span>}
          {data.client_name && <span className="mr-3">Cliente: <b>{data.client_name}</b></span>}
          {data.responsible_name && <span>Responsável: <b>{data.responsible_name}</b></span>}
        </div>
      </div>

      <div className="mb-7 -mx-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'visao' && <Overview data={data} onRefresh={refresh} />}
      {tab === 'timeline' && <TimelineTab data={data} onRefresh={refresh} />}
      {tab === 'documentos' && <DocumentsTab data={data} onRefresh={refresh} />}
      {tab === 'intimacoes' && <PublicationsTab data={data} onRefresh={refresh} />}
      {tab === 'tarefas' && <TasksTab data={data} onRefresh={refresh} />}
      {tab === 'ia' && <AiTab processId={data.id} onRefresh={refresh} />}
      {tab === 'auditoria' && <AuditTab processId={data.id} />}
      {tab === 'sincronizacao' && <SyncTab data={data} onRefresh={refresh} />}
    </div>
  );
}

function Overview({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [monitoringBusy, setMonitoringBusy] = useState(false);

  const toggleMonitoring = async (enabled: boolean) => {
    setMonitoringBusy(true);
    try {
      await apiPatch(`/api/processes/${data.id}/monitoring`, { enabled });
      await onRefresh();
    } catch {
      // erro ignorado — o refresh trará os dados corretos
    } finally {
      setMonitoringBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title="Resumo">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Título</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.title}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Número</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.process_number ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Tribunal</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.court ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Jurisdição</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.jurisdiction ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Área</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.area ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Status</dt><dd className="mt-1 text-sm font-medium text-gray-900">{statusLabel(data.status)}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Cliente</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.client_name ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Responsável</dt><dd className="mt-1 text-sm font-medium text-gray-900">{data.responsible_name ?? '—'}</dd></div>
          </dl>
          {data.description && <p className="mt-4 text-sm text-gray-700">{data.description}</p>}
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Monitoramento">
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd>
                {(() => {
                  const monErr = data.monitoring_status === 'ERROR' || Boolean(data.last_sync_error);
                  const monStale = data.monitoring_status === 'ACTIVE' && !monErr && data.monitoring_stale === true;
                  const badgeColor = monErr ? 'red' : monStale ? 'yellow' : data.monitoring_status === 'ACTIVE' ? 'green' : data.monitoring_status === 'PAUSED' ? 'yellow' : 'gray';
                  const badgeText = data.monitoring_status === 'ACTIVE' && !monErr && !monStale ? '🟢 Monitoramento ativo'
                    : monStale ? '🟡 Sincronização atrasada'
                    : monErr ? '🔴 Monitoramento com erro'
                    : data.monitoring_status === 'PAUSED' ? '⏸ Monitoramento pausado'
                    : '—';
                  return <Badge color={badgeColor}>{badgeText}</Badge>;
                })()}
              </dd>
            </div>
            <div className="flex justify-between"><dt className="text-gray-500">Última sincronização</dt><dd className="font-medium text-gray-900">{formatDateTime(data.last_synced_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Fonte</dt><dd className="font-medium text-gray-900">DataJud</dd></div>
            {data.last_sync_error && <div className="mt-2 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700">Último erro: {data.last_sync_error}</div>}
            <div className="pt-2">
              <button
                onClick={() => toggleMonitoring(false)}
                disabled={monitoringBusy || data.monitoring_status === 'PAUSED' || data.monitoring_status === 'ERROR'}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                {monitoringBusy ? '…' : '⏸ Pausar monitoramento'}
              </button>
              <button
                onClick={() => toggleMonitoring(true)}
                disabled={monitoringBusy || data.monitoring_status === 'ACTIVE'}
                className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                {monitoringBusy ? '…' : '▶ Ativar monitoramento'}
              </button>
            </div>
          </dl>
        </Card>
        <Card title="Contadores">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Documentos</span><b>{data.documents.length}</b></li>
            <li className="flex justify-between"><span>Intimações</span><b>{data.publications.length}</b></li>
            <li className="flex justify-between"><span>Tarefas</span><b>{data.tasks.length}</b></li>
            <li className="flex justify-between"><span>Eventos na timeline</span><b>{data.events.length}</b></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function TimelineTab({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost(`/api/processes/${data.id}/events`, { ...form, type: 'NOTE_ADDED', source: 'manual' });
      setShowAdd(false);
      setForm({ title: '', description: '' });
      await onRefresh();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowAdd(true)}>Adicionar evento</Button>
      </div>
      {data.events.length === 0 ? (
        <EmptyState title="Nenhum evento registrado." hint="Eventos reais aparecem aqui automaticamente." />
      ) : (
        <ol className="relative space-y-4 border-l border-gray-200 pl-6">
          {data.events.map((e) => (
            <li key={String(e.id)} className="relative">
              <span className="absolute -left-[31px] mt-1.5 h-3 w-3 rounded-full border-2 border-brand-600 bg-white" />
              <div className="text-sm font-semibold text-gray-900">{String(e.title)}</div>
              {Boolean(e.description) && <div className="text-sm text-gray-600">{String(e.description)}</div>}
              <div className="mt-0.5 text-xs text-gray-400">
                {formatDateTime(String(e.created_at))} {Boolean(e.created_by_name) && <span>· {String(e.created_by_name)}</span>}
                {Boolean(e.source) && <span> · {String(e.source)}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Adicionar evento">
        <form onSubmit={addEvent} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Título *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Descrição</label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Adicionar</Button>
        </form>
      </Modal>
    </div>
  );
}

function DocumentsTab({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('processId', data.id);
      formData.append('name', file.name);
      await apiUpload('/api/documents', formData);
      await onRefresh();
    } catch (err) { setError(err); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Excluir este documento?')) return;
    try {
      await apiDelete(`/api/documents/${docId}`);
      await onRefresh();
    } catch (err) { setError(err); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="meta font-medium">{data.documents.length} documento(s)</div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-brand-800/40 transition-all duration-200 hover:bg-brand-800 hover:shadow-elevated disabled:opacity-45">
          {uploading ? 'Enviando…' : 'Anexar documento'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      <ErrorAlert error={error} />
      {data.documents.length === 0 ? (
        <EmptyState title="Nenhum documento anexado." hint="Anexe um arquivo (PDF, DOCX, imagem…)." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="table-legal min-w-full">
            <thead className="bg-gray-50/70">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Tamanho</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Enviado por</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.documents.map((d) => (
                <tr key={String(d.id)}>
                  <td className="px-4 py-2">{String(d.name)}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{String(d.mime_type)}</td>
                  <td className="px-4 py-2 text-gray-500">{formatBytes(Number(d.size))}</td>
                  <td className="px-4 py-2 text-gray-500">{String(d.uploaded_by_name ?? '')}</td>
                  <td className="px-4 py-2 text-gray-500">{formatDate(String(d.created_at))}</td>
                  <td className="px-4 py-2 text-right">
                    <a href={downloadUrl(`/api/documents/${String(d.id)}/download`)} className="mr-3 text-sm link-quiet">Baixar</a>
                    <button onClick={() => handleDelete(String(d.id))} className="text-sm font-medium text-danger-600 underline-offset-4 transition-colors hover:text-danger-700 hover:underline">Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PublicationsTab({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ source: '', content: '', externalReference: '', possibleDueDate: '', availabilityDate: '' });
  const [formError, setFormError] = useState<unknown>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [analysisError, setAnalysisError] = useState<unknown>(null);

  const createPub = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/publications', {
        processId: data.id,
        source: form.source,
        content: form.content,
        externalReference: form.externalReference,
        possibleDueDate: form.possibleDueDate ? new Date(form.possibleDueDate).toISOString() : null,
        availabilityDate: form.availabilityDate ? new Date(form.availabilityDate).toISOString() : null,
      });
      setShowCreate(false);
      setForm({ source: '', content: '', externalReference: '', possibleDueDate: '', availabilityDate: '' });
      await onRefresh();
    } catch (err) { setFormError(err); }
  };

  const analyze = async (pubId: string) => {
    setAnalyzing(pubId);
    setAnalysis(null);
    setAnalysisError(null);
    try {
      const res = await apiPost<Record<string, unknown>>(`/api/ai/processes/${data.id}/analyze-publication/${pubId}`);
      setAnalysis(res);
    } catch (err) {
      setAnalysisError(err);
    } finally {
      setAnalyzing(null);
    }
  };

  const updateStatus = async (pubId: string, status: string) => {
    try {
      await apiPatch(`/api/publications/${pubId}`, { status });
      await onRefresh();
    } catch (err) { setAnalysisError(err); }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowCreate(true)}>Registrar intimação</Button>
      </div>
      <ErrorAlert error={analysisError} />
      {data.publications.length === 0 ? (
        <EmptyState title="Nenhuma intimação registrada." hint="Registre intimações reais recebidas do tribunal." />
      ) : (
        <div className="space-y-4">
          {data.publications.map((p) => (
            <div key={String(p.id)} className="surface p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {String(p.source ?? 'Intimação')}
                    <span className="ml-2"><Badge color={statusColor(String(p.status))}>{statusLabel(String(p.status))}</Badge></span>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    Publicação: {formatDateTime(String(p.publication_date))} · Disponibilização: {formatDateTime(String(p.availability_date))}
                    {Boolean(p.possible_due_date) && <span> · Prazo: <b>{formatDate(String(p.possible_due_date))}</b></span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => analyze(String(p.id))} disabled={analyzing === String(p.id)} className="px-3 py-1.5 text-xs">
                    {analyzing === String(p.id) ? 'Analisando…' : 'Analisar com IA'}
                  </Button>
                  {p.status !== 'PROCESSED' && (
                    <SecondaryButton onClick={() => updateStatus(String(p.id), 'PROCESSED')} className="px-3 py-1.5 text-xs">Marcar processada</SecondaryButton>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{String(p.content)}</p>
              {Boolean(p.external_reference) && <div className="mt-1 text-xs text-gray-400">Ref: {String(p.external_reference)}</div>}
              {Boolean(p.notes) && <div className="mt-1 text-xs text-gray-500">Obs: {String(p.notes)}</div>}
              {analysis && analysis.interactionId === String(p.id) && (
                <div className="mt-3 rounded border border-blue-100 bg-blue-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-blue-800">Análise da IA (revisão humana necessária)</div>
                  <FormattedAIOutput
                    output={(analysis.structured as Record<string, unknown> | null) ?? null}
                    rawText={typeof analysis.rawText === 'string' ? analysis.rawText : null}
                  />
                  <div className="mt-1 text-xs text-blue-700">{(analysis.disclaimer as string) ?? ''}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Registrar intimação">
        <form onSubmit={createPub} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Origem</label>
            <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex.: DJSP, e-SAJ…" />
          </div>
          <div>
            <label className="field-label">Data de disponibilização</label>
            <Input type="datetime-local" value={form.availabilityDate} onChange={(e) => setForm({ ...form, availabilityDate: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Conteúdo *</label>
            <Textarea rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Referência externa</label>
            <Input value={form.externalReference} onChange={(e) => setForm({ ...form, externalReference: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Prazo possível</label>
            <Input type="datetime-local" value={form.possibleDueDate} onChange={(e) => setForm({ ...form, possibleDueDate: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Registrar</Button>
        </form>
      </Modal>
    </div>
  );
}

function TasksTab({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueDate: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/tasks', {
        processId: data.id,
        title: form.title,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'MEDIUM', dueDate: '' });
      await onRefresh();
    } catch (err) { setFormError(err); }
  };

  const updateStatus = async (taskId: string, status: string) => {
    try {
      await apiPatch(`/api/tasks/${taskId}`, { status });
      await onRefresh();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowCreate(true)}>Nova tarefa</Button>
      </div>
      <ErrorAlert error={formError} />
      {data.tasks.length === 0 ? (
        <EmptyState title="Nenhuma tarefa." hint="Crie tarefas e prazos para este processo." />
      ) : (
        <div className="space-y-2">
          {data.tasks.map((t) => (
            <div key={String(t.id)} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{String(t.title)}</div>
                {Boolean(t.description) && <div className="mt-0.5 text-sm leading-relaxed text-gray-500">{String(t.description)}</div>}
                <div className="mt-0.5 flex gap-2 text-xs text-gray-400">
                  <Badge color={statusColor(String(t.priority))}>{statusLabel(String(t.priority))}</Badge>
                  <Badge color={statusColor(String(t.status))}>{statusLabel(String(t.status))}</Badge>
                  {Boolean(t.due_date) && <span>Prazo: {formatDate(String(t.due_date))}</span>}
                  {Boolean(t.assigned_name) && <span>· {String(t.assigned_name)}</span>}
                </div>
              </div>
              {String(t.status) === 'TODO' || String(t.status) === 'IN_PROGRESS' ? (
                <SecondaryButton onClick={() => updateStatus(String(t.id), 'DONE')} className="px-3 py-1.5 text-xs">Concluir</SecondaryButton>
              ) : (
                <button onClick={() => updateStatus(String(t.id), 'TODO')} className="text-xs font-medium text-gray-500 underline-offset-4 transition-colors hover:text-gray-800 hover:underline">Reabrir</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nova tarefa">
        <form onSubmit={createTask} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Título *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Descrição</label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Prioridade</label>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Crítica</option>
              </Select>
            </div>
            <div>
              <label className="field-label">Prazo</label>
              <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}

function AiTab({ processId, onRefresh }: { processId: string; onRefresh: () => Promise<void> }) {
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; disclaimer: string } | null>(null);
  const [interactions, setInteractions] = useState<AiInteraction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draftInstruction, setDraftInstruction] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 8;

  const load = useCallback(async () => {
    try {
      const [statusRes, interactionsRes] = await Promise.all([
        apiGet<{ configured: boolean; disclaimer: string }>('/api/ai/status'),
        apiGet<{ items: AiInteraction[] }>(`/api/ai/interactions?processId=${processId}`),
      ]);
      setAiStatus(statusRes);
      setInteractions(interactionsRes.items);
    } catch (e) { setError(e); }
  }, [processId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setPage(1);
    setExpanded(new Set());
  }, [processId]);

  const totalPages = Math.max(1, Math.ceil(interactions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = interactions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (kind: string, action: () => Promise<string | null>) => {
    setError(null);
    setBusy(kind);
    try {
      const newInteractionId = await action();
      await load();
      await onRefresh();
      if (newInteractionId) {
        setPage(1);
        setExpanded((prev) => new Set(prev).add(newInteractionId));
      }
    } catch (e) { setError(e); }
    finally { setBusy(null); }
  };

  const review = async (interactionId: string, status: string) => {
    setError(null);
    try {
      await apiPost(`/api/ai/interactions/${interactionId}/review`, { status });
      await load();
      await onRefresh();
    } catch (e) { setError(e); }
  };

  if (!aiStatus) return <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>;

  return (
    <div className="space-y-6">
      <Card title="IA contextual ao processo">
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          {aiStatus.disclaimer}
        </div>
        {!aiStatus.configured && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Serviço de IA não configurado. Defina OPENAI_API_KEY no ambiente ou ative AI_PROVIDER=local para usar o provedor offline.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            disabled={!aiStatus.configured || busy !== null}
            onClick={() => run('summarize', async () => {
              const res = await apiPost<{ interactionId?: string }>(`/api/ai/processes/${processId}/summarize`);
              return res.interactionId ?? null;
            })}
          >
            {busy === 'summarize' ? 'Resumindo…' : 'Resumir processo'}
          </Button>
          <div className="flex gap-2">
            <Input placeholder="Instrução para rascunho…" value={draftInstruction} onChange={(e) => setDraftInstruction(e.target.value)} />
            <Button
              disabled={!aiStatus.configured || busy !== null || !draftInstruction.trim()}
              onClick={() => run('draft', async () => { await apiPost(`/api/ai/processes/${processId}/draft`, { instruction: draftInstruction }); return null; })}
              className="shrink-0"
            >
              {busy === 'draft' ? 'Gerando…' : 'Gerar rascunho'}
            </Button>
          </div>
        </div>
        <ErrorAlert error={error} />
      </Card>

      <Card title="Histórico de interações de IA">
        {interactions.length === 0 ? (
          <EmptyState title="Nenhuma execução de IA registrada." />
        ) : (
          <div>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {pageItems.map((i) => {
                const lastApproval = i.approvals?.[i.approvals.length - 1];
                const isOpen = expanded.has(i.id);
                return (
                  <div key={i.id}>
                    <div
                      className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                      onClick={() => toggle(i.id)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`text-xs text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                        <span className="truncate text-sm font-medium">{statusLabel(String(i.type))}</span>
                        {i.model && <span className="truncate text-xs text-gray-400">{i.model}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {lastApproval ? (
                          <Badge color={statusColor(lastApproval.status)}>{statusLabel(lastApproval.status)}</Badge>
                        ) : (
                          <Badge color="yellow">Pendente revisão</Badge>
                        )}
                        <span className="text-xs text-gray-400">{formatDateTime(i.created_at)}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                        {i.output?.structured || i.output?.rawText ? (
                          <FormattedAIOutput output={i.output?.structured} rawText={i.output?.rawText} />
                        ) : (
                          <div className="text-sm italic text-gray-400">Sem conteúdo de saída.</div>
                        )}
                        {!lastApproval && (
                          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                            <SecondaryButton onClick={() => review(i.id, 'APPROVED')} className="px-3 py-1.5 text-xs">Aprovar</SecondaryButton>
                            <SecondaryButton onClick={() => review(i.id, 'REJECTED')} className="px-3 py-1 text-xs text-red-600">Rejeitar</SecondaryButton>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {pageItems.length} de {interactions.length} · Página {safePage} de {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <SecondaryButton disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="px-3 py-1.5 text-xs">Anterior</SecondaryButton>
                  <SecondaryButton disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className="px-3 py-1.5 text-xs">Próxima</SecondaryButton>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function AuditTab({ processId }: { processId: string }) {
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    apiGet<{ items: Array<Record<string, unknown>> }>(`/api/audit?entity=case&entityId=${processId}`)
      .then((r) => setLogs(r.items))
      .catch(setError);
  }, [processId]);

  if (error) return <ErrorAlert error={error} />;
  if (logs.length === 0) return <EmptyState title="Nenhum log de auditoria para este processo." />;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="table-legal min-w-full">
        <thead className="bg-gray-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Ação</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Usuário</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Detalhes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.map((l) => (
            <tr key={String(l.id)}>
              <td className="px-4 py-2 text-gray-500">{formatDateTime(String(l.created_at))}</td>
              <td className="px-4 py-2 font-medium">{String(l.action)}</td>
              <td className="px-4 py-2 text-gray-500">{String(l.user_name ?? '')}</td>
              <td className="px-4 py-2 text-xs text-gray-400">
                {l.after ? <pre className="whitespace-pre-wrap">{JSON.stringify(l.after).slice(0, 120)}</pre> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SyncRun {
  id: string;
  source: string;
  status: string;
  found_count: number;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  user_name: string | null;
}

interface SyncResponse {
  status: string;
  found: number;
  inserted: number;
  duplicates: number;
  errors: number;
  synchronizedAt: string;
  errorMessage?: string | null;
}

function SyncTab({ data, onRefresh }: { data: ProcessDetail; onRefresh: () => Promise<void> }) {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastResult, setLastResult] = useState<SyncResponse | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiGet<{ items: SyncRun[] }>(`/api/processes/${data.id}/sync-runs`);
      setRuns(res.items);
    } catch (e) { setError(e); }
  }, [data.id]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const doSync = async () => {
    setSyncing(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await apiPost<SyncResponse>(`/api/processes/${data.id}/sync`);
      setLastResult(res);
      await loadRuns();
      await onRefresh();
    } catch (e) { setError(e); }
    finally { setSyncing(false); }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card title="Sincronizar processo">
        <p className="mb-4 text-sm text-gray-600">
          Consulta este processo na fonte judicial (DataJud) para identificar novas movimentações.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void doSync()} disabled={syncing || !data.process_number}>
            {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
          <span className="text-xs text-gray-400">
            Última sincronização: {formatDateTime(data.last_synced_at)}
          </span>
        </div>
        <ErrorAlert error={error} />
        {lastResult && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2">
              <Badge color={lastResult.status === 'SUCCESS' ? 'green' : lastResult.status === 'PARTIAL' ? 'yellow' : 'red'}>
                {lastResult.status}
              </Badge>
              <span className="text-gray-500">Sincronização concluída em {formatDateTime(lastResult.synchronizedAt)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><div className="text-[11px] uppercase tracking-wide text-gray-400">Encontrados</div><div className="font-semibold text-gray-900">{lastResult.found}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-400">Novos</div><div className="font-semibold text-green-700">{lastResult.inserted}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-400">Duplicados</div><div className="font-semibold text-gray-900">{lastResult.duplicates}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-400">Erros</div><div className="font-semibold text-danger-700">{lastResult.errors}</div></div>
            </div>
            {lastResult.errorMessage && <div className="mt-2 text-xs text-danger-700">{lastResult.errorMessage}</div>}
          </div>
        )}
      </Card>

      <Card title="Histórico de sincronizações">
        {runs.length === 0 ? (
          <EmptyState title="Nenhuma sincronização registrada." hint="Use o botão acima para consultar o processo na fonte." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-legal min-w-full">
              <thead className="bg-gray-50/70">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Fonte</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Encontrados</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Novos</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Duplicados</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-gray-500">{formatDateTime(r.started_at)}</td>
                    <td className="px-4 py-2 font-medium">{r.source}</td>
                    <td className="px-4 py-2 text-gray-500">{r.found_count}</td>
                    <td className="px-4 py-2 font-medium text-green-700">{r.imported_count}</td>
                    <td className="px-4 py-2 text-gray-500">{r.duplicate_count}</td>
                    <td className="px-4 py-2">
                      <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}