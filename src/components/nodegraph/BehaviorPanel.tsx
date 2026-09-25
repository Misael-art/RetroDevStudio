import { useMemo, useState, type ReactElement } from "react";

import {
  BEHAVIOR_LIBRARY,
  defaultBehaviorParams,
  getBehaviorDefinition,
  planApplyBehavior,
  planEditBehavior,
  planRemoveBehavior,
  validateBehaviorInstances,
  type BehaviorParamSpec,
  type BehaviorParams,
  type BehaviorPlan,
  type BehaviorSceneContext,
} from "../../core/nodegraph/behaviorLibrary";
import { MEGADRIVE_INPUT_BUTTONS, describeInputButton } from "../../core/nodegraph/nodeCatalog";
import AssetPreview from "../common/AssetPreview";
import type { NodeGraph } from "../../core/nodegraph/nodeTypes";

type Mode =
  | { kind: "add"; behaviorId: string; params: BehaviorParams }
  | { kind: "edit"; instanceId: string; params: BehaviorParams }
  | { kind: "remove"; instanceId: string }
  | null;

type Props = {
  graph: NodeGraph;
  context: BehaviorSceneContext;
  selectedEntityId: string;
  projectDir?: string | null;
  onCommit: (graph: NodeGraph, label: string, message: string) => void;
  onShowInstance: (nodeIds: string[]) => void;
};

const fieldClass = "w-full rounded border border-[#45475a] bg-[#11111b] px-1 py-0.5 text-[10px] text-[#cdd6f4]";

/** Miniatura do primeiro quadro do sprite real da entidade escolhida. */
function EntityThumb({ context, entityId, projectDir }: { context: BehaviorSceneContext; entityId: string; projectDir?: string | null }) {
  const entity = context.entities.find((candidate) => candidate.id === entityId);
  if (!entity?.spriteAsset || !projectDir) return null;
  const width = entity.frameWidth ?? 16;
  const height = entity.frameHeight ?? 16;
  const scale = 20 / Math.max(1, width, height);
  return (
    <span
      data-testid={`behavior-thumb-${entityId}`}
      className="relative inline-block shrink-0 overflow-hidden rounded bg-[#11111b]"
      style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      title={entity.spriteAsset}
    >
      <span className="absolute left-0 top-0 block" style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <AssetPreview alt={entity.label} projectDir={projectDir} relativePath={entity.spriteAsset} imageClassName="max-w-none" fallbackClassName="h-4 w-4" fallbackLabel="" pixelated />
      </span>
    </span>
  );
}

function ParamField({
  spec,
  params,
  context,
  graph,
  projectDir,
  onChange,
}: {
  spec: BehaviorParamSpec;
  params: BehaviorParams;
  context: BehaviorSceneContext;
  graph: NodeGraph;
  projectDir?: string | null;
  onChange: (key: string, value: string | number) => void;
}) {
  const value = params[spec.key] ?? "";
  const testId = `behavior-param-${spec.key}`;
  let control: ReactElement = <span />;
  switch (spec.kind) {
    case "entity": {
      const options = context.entities.filter((entity) => (spec.require === "sprite" ? entity.hasSprite : entity.hasSprite || entity.hasCollision));
      control = (
        <span className="flex items-center gap-1">
          <EntityThumb context={context} entityId={String(value)} projectDir={projectDir} />
          <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
            {spec.optional && <option value="">(nenhuma)</option>}
            {value && !options.some((entity) => entity.id === value) && <option value={String(value)}>{`${value} (invalida)`}</option>}
            {!spec.optional && !value && <option value="">(escolha)</option>}
            {options.map((entity) => (
              <option key={entity.id} value={entity.id}>{entity.label}</option>
            ))}
          </select>
        </span>
      );
      break;
    }
    case "text":
      control = (
        <input data-testid={testId} value={String(value)} maxLength={24} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass} />
      );
      break;
    case "choice":
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          {spec.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
      break;
    case "counter": {
      const counters = context.counters ?? [];
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          {spec.optional && <option value="">(nenhum)</option>}
          {value && !counters.some((counter) => counter.instanceId === value) && <option value={String(value)}>(contador removido)</option>}
          {!spec.optional && !value && <option value="">(escolha)</option>}
          {counters.map((counter) => (
            <option key={counter.instanceId} value={counter.instanceId}>
              {counter.label} ({counter.scope === "entity" ? `de ${context.entities.find((entity) => entity.id === counter.ownerEntity)?.label ?? counter.ownerEntity}` : "compartilhado"})
            </option>
          ))}
        </select>
      );
      break;
    }
    case "int":
      control = (
        <span className="flex items-center gap-1">
          <input
            data-testid={testId}
            type="number"
            min={spec.min}
            max={spec.max}
            value={String(value)}
            onChange={(event) => onChange(spec.key, event.target.value === "" ? "" : Number(event.target.value))}
            className={`${fieldClass} w-20 text-right font-mono`}
          />
          <span className="text-[9px] text-[#6c7086]">{spec.unit ? `${spec.unit}, ` : ""}{spec.min}–{spec.max}</span>
        </span>
      );
      break;
    case "button":
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          {spec.optional && <option value="">(nenhum)</option>}
          {MEGADRIVE_INPUT_BUTTONS.map((button) => {
            const described = describeInputButton(button);
            return (
              <option key={button} value={button}>
                {described.padLabel}{described.keyLabel ? ` · tecla ${described.keyLabel}` : ""}
              </option>
            );
          })}
        </select>
      );
      break;
    case "animation": {
      const owner = context.entities.find((entity) => entity.id === String(params[spec.ofEntityParam] ?? ""));
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          <option value="">(nenhuma)</option>
          {(owner?.animations ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      );
      break;
    }
    case "sound":
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          <option value="">(nenhum)</option>
          {context.sounds.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      );
      break;
    case "variable":
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          {!context.variables.includes(String(value)) && <option value={String(value)}>{value ? `${value} (ninguem escreve)` : "(escolha)"}</option>}
          {context.variables.map((name) => <option key={name} value={name}>{context.variableLabels?.[name] ?? name}</option>)}
        </select>
      );
      break;
    case "instance": {
      const options = (graph.behaviors ?? []).filter((instance) => instance.behaviorId === spec.behaviorId);
      control = (
        <select data-testid={testId} value={String(value)} onChange={(event) => onChange(spec.key, event.target.value)} className={fieldClass}>
          {!options.some((instance) => instance.id === value) && <option value={String(value)}>(escolha)</option>}
          {options.map((instance) => <option key={instance.id} value={instance.id}>{instance.label}</option>)}
        </select>
      );
      break;
    }
  }
  return (
    <label className="block">
      <span className="text-[10px] text-[#a6adc8]">{spec.label}</span>
      {control}
      {spec.help ? <span className="block text-[9px] text-[#6c7086]">{spec.help}</span> : null}
    </label>
  );
}

function PlanFeedback({ plan, confirmed, setConfirmed }: { plan: BehaviorPlan; confirmed: boolean; setConfirmed: (value: boolean) => void }) {
  return (
    <>
      {plan.summary ? <p data-testid="behavior-summary" className="rounded bg-[#a6e3a1]/10 px-1.5 py-1 text-[10px] text-[#a6e3a1]">Resultado: {plan.summary}</p> : null}
      {plan.errors.length > 0 && (
        <ul data-testid="behavior-errors" className="space-y-0.5 text-[10px] text-[#f38ba8]">
          {plan.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      {plan.errors.length === 0 && plan.conflicts.length > 0 && (
        <div data-testid="behavior-conflicts" className="rounded border border-[#fab387]/50 bg-[#fab387]/10 px-1.5 py-1 text-[10px] text-[#fab387]">
          {plan.conflicts.map((conflict) => <p key={conflict.message}>{conflict.message}</p>)}
          <label className="mt-1 flex items-center gap-1">
            <input data-testid="behavior-confirm-conflicts" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Entendi, continuar mesmo assim
          </label>
        </div>
      )}
    </>
  );
}

/**
 * Comportamentos parametrizados (Experimental): descobrir, configurar, aplicar, editar e
 * remover sem conhecer ids internos. Toda acao passa pelo historico do grafo.
 */
/** Contadores da cena: quais itens os alimentam e quais passagens/objetivos os usam. */
function LinksSummary({ context }: { context: BehaviorSceneContext }) {
  const counters = context.counters ?? [];
  if (counters.length === 0) return null;
  const host = (id: string) => context.entities.find((entity) => entity.id === id)?.label ?? id;
  return (
    <div data-testid="behavior-links" className="mt-1.5 rounded border border-[#313244] bg-[#11111b] px-1.5 py-1">
      <p className="text-[9px] uppercase tracking-[0.12em] text-[#6c7086]">Ligacoes</p>
      {counters.map((counter) => {
        const users = (context.references ?? []).filter((reference) => reference.refs.includes(counter.instanceId) || reference.refs.includes(counter.varName));
        const feeders = users.filter((reference) => reference.behaviorId === "collectible");
        const consumers = users.filter((reference) => reference.behaviorId !== "collectible");
        return (
          <p key={counter.instanceId} data-testid={`behavior-links-${counter.instanceId}`} className="text-[#a6adc8]">
            <span className="font-semibold text-[#cdd6f4]">{counter.label}</span> ({counter.scope === "entity" ? `de ${host(counter.ownerEntity ?? "")}` : "compartilhado"}):
            {" "}alimentado por {feeders.length ? feeders.map((ref) => `${ref.label}`).join(", ") : "nenhum item"}; usado por {consumers.length ? consumers.map((ref) => `${ref.label} (${host(ref.hostEntity)})`).join(", ") : "ninguem"}.
          </p>
        );
      })}
      <p className="mt-0.5 text-[9px] text-[#6c7086]">
        Salvar o projeto guarda a configuracao, nao o progresso da partida: contadores, itens coletados, passagens e objetivos voltam ao inicio a cada partida (parar e jogar de novo).
      </p>
    </div>
  );
}

export default function BehaviorPanel({ graph, context, selectedEntityId, projectDir, onCommit, onShowInstance }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [confirmed, setConfirmed] = useState(false);
  const issues = useMemo(() => validateBehaviorInstances(graph, context), [context, graph]);
  const plan = useMemo<BehaviorPlan | null>(() => {
    if (!mode) return null;
    if (mode.kind === "add") return planApplyBehavior(graph, mode.behaviorId, mode.params, context);
    if (mode.kind === "edit") return planEditBehavior(graph, mode.instanceId, mode.params, context);
    return planRemoveBehavior(graph, mode.instanceId, context);
  }, [context, graph, mode]);
  const start = (next: Mode) => {
    setConfirmed(false);
    setMode(next);
  };
  const change = (key: string, value: string | number) => {
    if (!mode || mode.kind === "remove") return;
    setConfirmed(false);
    setMode({ ...mode, params: { ...mode.params, [key]: value } });
  };
  const commit = () => {
    if (!mode || !plan?.ok || !plan.graph || (plan.conflicts.length > 0 && !confirmed)) return;
    const instance = (graph.behaviors ?? []).find((candidate) => candidate.id === (mode.kind === "add" ? "" : mode.instanceId));
    const label =
      mode.kind === "add"
        ? `Aplicar "${getBehaviorDefinition(mode.behaviorId)?.title}"`
        : mode.kind === "edit"
          ? `Editar "${instance?.label}"`
          : `Remover "${instance?.label}"`;
    onCommit(plan.graph, label, mode.kind === "remove" ? plan.summary : `${label}: ${plan.summary}`);
    if (mode.kind === "add" && plan.instanceId) {
      const created = plan.graph.behaviors?.find((candidate) => candidate.id === plan.instanceId);
      if (created) onShowInstance(created.nodeIds);
    }
    setMode(null);
  };
  const definition = mode && mode.kind !== "remove" ? getBehaviorDefinition(mode.kind === "add" ? mode.behaviorId : (graph.behaviors ?? []).find((i) => i.id === mode.instanceId)?.behaviorId ?? "") : undefined;
  const canCommit = Boolean(plan?.ok && plan.graph && (plan.conflicts.length === 0 || confirmed));

  return (
    <div data-testid="nodegraph-behaviors" className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/5 px-2 py-1.5 text-[10px] text-[#cdd6f4]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Comportamentos (Experimental)</p>
      {(graph.behaviors ?? []).length === 0 ? (
        <p className="mt-1 text-[#6c7086]">Nenhum ainda. Comportamentos prontos geram os nos para voce e podem ser reconfigurados depois.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {(graph.behaviors ?? []).map((instance) => {
            const instanceDefinition = getBehaviorDefinition(instance.behaviorId);
            const instanceIssues = issues.filter((issue) => issue.instanceId === instance.id);
            return (
              <li key={instance.id} data-testid={`behavior-instance-${instance.id}`} className="rounded border border-[#313244] bg-[#11111b] px-1.5 py-1">
                <p className="font-semibold">{instance.label}</p>
                <p className="text-[#a6adc8]">{instanceDefinition?.summarize(instance.params, context)}</p>
                {instanceIssues.map((issue) => <p key={issue.message} className="text-[#f38ba8]">{issue.message}</p>)}
                <div className="mt-1 flex gap-1">
                  <button type="button" data-testid={`behavior-view-${instance.id}`} onClick={() => onShowInstance(instance.nodeIds)} className="rounded px-1 text-[#89b4fa] hover:bg-[#313244]">Ver no grafo</button>
                  <button type="button" data-testid={`behavior-edit-${instance.id}`} onClick={() => start({ kind: "edit", instanceId: instance.id, params: { ...instance.params } })} className="rounded px-1 text-[#cdd6f4] hover:bg-[#313244]">Editar</button>
                  <button type="button" data-testid={`behavior-remove-${instance.id}`} onClick={() => start({ kind: "remove", instanceId: instance.id })} className="rounded px-1 text-[#f38ba8] hover:bg-[#313244]">Remover</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <LinksSummary context={context} />

      {!mode && (
        <div className="mt-1.5 space-y-1">
          <p className="text-[9px] uppercase tracking-[0.12em] text-[#6c7086]">Adicionar a esta entidade</p>
          {BEHAVIOR_LIBRARY.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid={`behavior-add-${candidate.id}`}
              onClick={() => start({ kind: "add", behaviorId: candidate.id, params: defaultBehaviorParams(candidate, context, graph, selectedEntityId) })}
              className="block w-full rounded border border-[#89b4fa]/40 px-1.5 py-1 text-left hover:bg-[#89b4fa]/15"
            >
              <span className="font-semibold text-[#89b4fa]">+ {candidate.title}</span>
              <span className="block text-[#a6adc8]">{candidate.description}</span>
            </button>
          ))}
        </div>
      )}

      {mode && mode.kind !== "remove" && definition && (
        <div data-testid="behavior-form" className="mt-1.5 space-y-1 rounded border border-[#45475a] bg-[#181825] p-1.5">
          <p className="font-semibold">{mode.kind === "add" ? `Novo: ${definition.title}` : `Editar: ${definition.title}`}</p>
          {definition.params.map((spec) => (
            <ParamField key={spec.key} spec={spec} params={mode.params} context={context} graph={graph} projectDir={projectDir} onChange={change} />
          ))}
          {plan ? <PlanFeedback plan={plan} confirmed={confirmed} setConfirmed={setConfirmed} /> : null}
          <div className="flex gap-1">
            <button type="button" data-testid="behavior-apply" disabled={!canCommit} onClick={commit} className="rounded border border-[#a6e3a1]/50 bg-[#a6e3a1]/10 px-2 py-0.5 font-semibold text-[#a6e3a1] disabled:opacity-40">
              {mode.kind === "add" ? "Aplicar" : "Salvar alteracoes"}
            </button>
            <button type="button" data-testid="behavior-cancel" onClick={() => setMode(null)} className="rounded px-2 py-0.5 text-[#a6adc8] hover:bg-[#313244]">Cancelar</button>
          </div>
        </div>
      )}

      {mode?.kind === "remove" && plan && (
        <div data-testid="behavior-remove-form" className="mt-1.5 space-y-1 rounded border border-[#f38ba8]/40 bg-[#181825] p-1.5">
          {plan.ok ? <p className="text-[#cdd6f4]">{plan.summary}</p> : null}
          <PlanFeedback plan={{ ...plan, summary: "" }} confirmed={confirmed} setConfirmed={setConfirmed} />
          <div className="flex gap-1">
            <button type="button" data-testid="behavior-remove-confirm" disabled={!canCommit} onClick={commit} className="rounded border border-[#f38ba8]/50 px-2 py-0.5 font-semibold text-[#f38ba8] disabled:opacity-40">Remover</button>
            <button type="button" data-testid="behavior-cancel" onClick={() => setMode(null)} className="rounded px-2 py-0.5 text-[#a6adc8] hover:bg-[#313244]">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
