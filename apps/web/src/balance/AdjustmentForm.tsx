import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { todayLocal } from '../schedule/format';
import {
  ConfirmDialog,
  FormActions,
  FormPage,
  FormSection,
} from '@diovanibmotta/plantao365-web-sdk';
import { Diff } from './Diff';
import { formatDate, formatSignedHours, parseHours } from './format';
import { BALANCE_PATH, adjustmentsListPath } from './paths';
import type { Adjustment, TeamBalanceData } from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Member {
  userId: string;
  name: string;
}

const describe = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

/**
 * Lançamento de um ajuste de horas (rota própria). O ajuste é imutável: a API não edita, então o
 * registro existente abre somente leitura, com Excluir (corrige-se excluindo e lançando outro).
 */
export function AdjustmentForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [existing, setExisting] = useState<Adjustment | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const existingYear = existing ? Number(existing.date.slice(0, 4)) : null;

  useEffect(() => {
    if (!isNew) return;
    const controller = new AbortController();
    api
      .get<TeamBalanceData>(`/api/balance?year=${todayLocal().slice(0, 4)}`, controller.signal)
      .then((team) => setMembers(team.members.map((m) => ({ userId: m.userId, name: m.name }))))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setFetchError(describe(err, 'Não foi possível carregar os membros.'));
        }
      });
    return () => controller.abort();
  }, [isNew]);

  useEffect(() => {
    if (isNew) return;
    const controller = new AbortController();
    api
      .get<{ adjustment: Adjustment }>(`/api/balance/adjustments/${id}`, controller.signal)
      .then((r) => setExisting(r.adjustment))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setFetchError(describe(err, 'Não foi possível carregar o ajuste.'));
        }
      });
    return () => controller.abort();
  }, [isNew, id]);

  useEffect(() => {
    if (existingYear === null) return;
    const controller = new AbortController();
    api
      .get<TeamBalanceData>(`/api/balance?year=${existingYear}`, controller.signal)
      .then((team) => setMembers(team.members.map((m) => ({ userId: m.userId, name: m.name }))))
      .catch(() => setMembers([]));
    return () => controller.abort();
  }, [existingYear]);

  const listPath = adjustmentsListPath(existingYear ?? undefined);
  const back = (year?: number) => void navigate(year ? adjustmentsListPath(year) : listPath);
  const nameOf = (uid: string) => members?.find((m) => m.userId === uid)?.name ?? '—';

  const crumbs = [
    { label: 'Saldo de horas', to: BALANCE_PATH },
    { label: 'Ajustes', to: listPath },
    { label: isNew ? 'Novo ajuste' : 'Ajuste' },
  ];

  const save = async () => {
    const amount = parseHours(hours);
    if (!userId) return setProblem('Selecione o membro.');
    if (!ISO_DATE.test(date)) return setProblem('Informe a data.');
    if (amount === null || amount === 0 || Math.abs(amount) > 48) {
      return setProblem('Informe as horas, positivas ou negativas, diferentes de zero (até 48).');
    }
    if (!reason.trim()) return setProblem('Informe o motivo.');
    setProblem(null);
    setBusy(true);
    try {
      await api.post(
        '/api/balance/adjustments',
        { userId, date, hours: amount, reason: reason.trim() },
        { successMessage: 'Ajuste criado.' },
      );
      back(Number(date.slice(0, 4)));
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await api.delete(`/api/balance/adjustments/${existing.id}`, {
        successMessage: 'Ajuste excluído.',
      });
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (fetchError) {
    return (
      <FormPage crumbs={crumbs} title="Ajuste de saldo" onSubmit={() => back()}>
        <p className="alert" role="alert">
          {fetchError}
        </p>
        <div className="ui-actions">
          <button type="button" className="btn" onClick={() => back()}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (members === null || (!isNew && !existing)) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  if (existing) {
    const who = nameOf(existing.userId);
    return (
      <>
        <FormPage
          crumbs={crumbs}
          title="Ajuste de saldo"
          description="Um ajuste lançado não é editado: para corrigir, exclua e lance outro."
          onSubmit={() => back()}
        >
          <FormSection title="Ajuste" description="Dados do lançamento.">
            <dl className="ui-fields">
              <div className="ui-field">
                <dt>Membro</dt>
                <dd>{who}</dd>
              </div>
              <div className="ui-field">
                <dt>Data</dt>
                <dd>{formatDate(existing.date)}</dd>
              </div>
              <div className="ui-field">
                <dt>Horas</dt>
                <dd>
                  <Diff value={existing.hours} />
                </dd>
              </div>
              <div className="ui-field ui-field--wide">
                <dt>Motivo</dt>
                <dd>{existing.reason}</dd>
              </div>
              <div className="ui-field">
                <dt>Lançado por</dt>
                <dd>{nameOf(existing.createdBy)}</dd>
              </div>
            </dl>
          </FormSection>
          <div className="ui-actions">
            <button
              type="button"
              className="btn ui-danger"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Excluir
            </button>
            <span className="ui-actions-spacer" />
            <button type="submit" className="btn primary">
              Voltar
            </button>
          </div>
        </FormPage>
        {confirming && (
          <ConfirmDialog
            title={`Excluir o ajuste de ${who} em ${formatDate(existing.date)}?`}
            message={`O saldo de ${who} deixa de contar ${formatSignedHours(existing.hours)}. A exclusão fica registrada na auditoria.`}
            confirmLabel="Excluir"
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  const clearProblem = () => setProblem(null);

  return (
    <FormPage
      crumbs={crumbs}
      title="Novo ajuste"
      description="Corrige o saldo de horas de um membro com um lançamento manual."
      onSubmit={() => void save()}
    >
      <FormSection title="Ajuste" description="Quem, quando e quantas horas somar ou descontar.">
        <div className="ui-fields">
          <label className="ui-field">
            Membro
            <select
              value={userId}
              onChange={(e) => {
                clearProblem();
                setUserId(e.target.value);
              }}
            >
              <option value="">Selecione…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => {
                clearProblem();
                setDate(e.target.value);
              }}
            />
          </label>
          <label className="ui-field">
            Horas (+/-)
            <input
              type="text"
              inputMode="decimal"
              placeholder="ex.: -2,5"
              value={hours}
              onChange={(e) => {
                clearProblem();
                setHours(e.target.value);
              }}
            />
          </label>
          <label className="ui-field ui-field--wide">
            Motivo
            <input
              type="text"
              maxLength={300}
              value={reason}
              onChange={(e) => {
                clearProblem();
                setReason(e.target.value);
              }}
            />
          </label>
        </div>
      </FormSection>
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
      <FormActions busy={busy} onCancel={() => back()} />
    </FormPage>
  );
}
