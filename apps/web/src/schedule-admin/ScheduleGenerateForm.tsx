import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, describeApiError } from '../api/client';
import type { ApiError } from '../api/client';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { SCHEDULE_ADMIN_PATH, schedulePath, tabPath } from './paths';
import { errorCode } from './types';
import type { GenerateResult } from './types';

const generateError = (err: ApiError): string => {
  const code = errorCode(err);
  if (code === 'schedule_overlap') {
    return 'O período se sobrepõe a um rascunho existente. Descarte-o ou escolha outro período.';
  }
  if (code === 'no_eligible_members') {
    return 'A equipe não tem membros ativos na rotação. Cadastre ou ative membros que participam da rotação antes de gerar a escala.';
  }
  return describeApiError(err);
};

/** Geração de um rascunho para um período; ao concluir, abre o editor com o relatório. */
export function ScheduleGenerateForm() {
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const back = () => void navigate(tabPath('schedules'));

  const generate = async () => {
    if (!from || !to) {
      setProblem('Informe o início e o fim do período.');
      return;
    }
    if (from > to) {
      setProblem('O início deve ser anterior ou igual ao fim do período.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<GenerateResult>(
        '/api/schedules/generate',
        { from, to },
        { successMessage: 'Rascunho gerado.', errorMessage: generateError },
      );
      void navigate(schedulePath(result.schedule.id), { state: { result } });
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormPage
      crumbs={[
        { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
        { label: 'Escalas', to: tabPath('schedules') },
        { label: 'Gerar escala' },
      ]}
      title="Gerar escala"
      description="Cria um rascunho com a rotação da equipe para o período; você revisa e publica depois."
      onSubmit={() => void generate()}
    >
      <FormSection title="Período" description="Datas inicial e final, inclusivas.">
        <div className="ui-fields">
          <label className="ui-field">
            De
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setProblem(null);
                setFrom(e.target.value);
              }}
            />
          </label>
          <label className="ui-field">
            Até
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setProblem(null);
                setTo(e.target.value);
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
      <FormActions busy={busy} onCancel={back} saveLabel="Gerar rascunho" />
    </FormPage>
  );
}
