import { describe, expect, it } from "vitest";

import {
  buildBehaviorSceneContext,
  defaultBehaviorParams,
  duplicateBehaviorLogic,
  getBehaviorDefinition,
  manuallyEditedNodes,
  passageOpenVariable,
  planApplyBehavior,
  planEditBehavior,
  planRemoveBehavior,
  validateBehaviorInstances,
  type BehaviorSceneContext,
} from "./behaviorLibrary";
import { deserializeNodeGraph } from "./nodeDefinitions";
import { findNodeOverlaps, graphSemanticSignature } from "./nodeLayout";
import { serializeNodeGraph, type NodeGraph } from "./nodeTypes";

const sprite = (animations: string[] = ["idle", "jump"]) => ({ animations: Object.fromEntries(animations.map((name) => [name, {}])) });
const context: BehaviorSceneContext = buildBehaviorSceneContext(
  [
    { entity_id: "fox", display_name: "Raposa", components: { sprite: sprite(), physics: {}, collision: {}, audio: { sfx: { jump: "a.wav" } } } },
    { entity_id: "fox_2", display_name: "Raposa 2", components: { sprite: sprite(), physics: {}, collision: {} } },
    { entity_id: "ghost", components: { sprite: sprite([]) } },
    { entity_id: "gate", components: { sprite: sprite([]), collision: {} } },
    { entity_id: "camera", components: {} },
  ],
  [{ nodes: [{ id: "s", type: "var_set", label: "s", x: 0, y: 0, inputs: [], outputs: [], params: { var_name: "score", value: 0 } }], edges: [] }]
);
const EMPTY: NodeGraph = { nodes: [], edges: [] };
const moveParams = (target: string, extra: Record<string, string | number> = {}) => ({
  ...defaultBehaviorParams(getBehaviorDefinition("platform_movement")!, context, EMPTY, target),
  ...extra,
});

function apply(graph: NodeGraph, behaviorId: string, params: Record<string, string | number>) {
  const plan = planApplyBehavior(graph, behaviorId, params, context);
  expect(plan.errors).toEqual([]);
  return { graph: plan.graph!, id: plan.instanceId!, plan };
}

describe("behavior library", () => {
  it("generates canonical nodes with per-instance ids, a summary and a visual group", () => {
    const { graph, id, plan } = apply(EMPTY, "platform_movement", moveParams("fox", { speed: 3, jump_sound: "jump", jump_animation: "jump" }));
    expect(id).toBe("bh_move_fox_1");
    expect(plan.summary).toContain("Raposa anda 3 px por quadro");
    expect(plan.summary).toContain('tocando "jump"');
    const move = graph.nodes.find((node) => node.id === `${id}__right_move`)!;
    expect(move).toMatchObject({ type: "sprite_move", params: expect.objectContaining({ target: "fox", dx: 3, behavior_instance: id }) });
    expect(graph.nodes.find((node) => node.id === `${id}__jump_velocity`)!.params.vy).toBe(-64);
    // Salto so do chao: apertar -> esta no chao? (Sim) -> impulso; nenhum caminho direto.
    expect(graph.nodes.find((node) => node.id === `${id}__jump_ground`)).toMatchObject({ type: "condition_on_ground", params: expect.objectContaining({ target: "fox" }) });
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNode: `${id}__jump_input`, toNode: `${id}__jump_ground` }),
      expect.objectContaining({ fromNode: `${id}__jump_ground`, fromPort: "true", toNode: `${id}__jump_velocity` }),
    ]));
    expect(graph.edges.some((edge) => edge.fromNode === `${id}__jump_input` && edge.toNode === `${id}__jump_velocity`)).toBe(false);
    expect(graph.groups).toEqual([expect.objectContaining({ id, nodeIds: graph.behaviors![0].nodeIds })]);
    expect(findNodeOverlaps(graph)).toEqual([]);
    // Persistencia: a instancia sobrevive a serializar/reabrir.
    const reopened = deserializeNodeGraph(serializeNodeGraph(graph));
    expect(reopened.behaviors).toEqual(graph.behaviors);
    expect(validateBehaviorInstances(reopened, context)).toEqual([]);
  });

  it("keeps two instances on two entities independent (negative control for shared state / wrong target)", () => {
    const a = apply(EMPTY, "platform_movement", moveParams("fox", { speed: 1 }));
    const b = apply(a.graph, "platform_movement", moveParams("fox_2", { speed: 3, right_button: "BUTTON_C", left_button: "", jump_button: "BUTTON_START" }));
    const node = (graph: NodeGraph, id: string) => graph.nodes.find((candidate) => candidate.id === id)!;
    expect(node(b.graph, `${a.id}__right_move`).params).toMatchObject({ target: "fox", dx: 1 });
    expect(node(b.graph, `${b.id}__right_move`).params).toMatchObject({ target: "fox_2", dx: 3 });
    expect(node(b.graph, `${b.id}__right_input`).params.button).toBe("BUTTON_C");

    const edited = planEditBehavior(b.graph, b.id, { ...b.graph.behaviors![1].params, speed: 5 }, context);
    expect(edited.errors).toEqual([]);
    expect(node(edited.graph!, `${b.id}__right_move`).params.dx).toBe(5);
    // Editar a segunda nao muda a primeira: nos, arestas e parametros identicos.
    const firstOf = (graph: NodeGraph) => ({
      nodes: graph.nodes.filter((candidate) => candidate.params.behavior_instance === a.id),
      edges: graph.edges.filter((edge) => edge.id.startsWith(a.id)),
      instance: graph.behaviors!.find((instance) => instance.id === a.id),
    });
    expect(firstOf(edited.graph!)).toEqual(firstOf(b.graph));
  });

  it("refuses invalid references with a useful message", () => {
    const bad = (params: Record<string, string | number>) => planApplyBehavior(EMPTY, "platform_movement", params, context).errors.join(" | ");
    expect(bad(moveParams("fox", { target: "nope" }))).toContain('"nope" nao existe');
    expect(bad(moveParams("fox", { target: "camera" }))).toContain("nao tem sprite");
    expect(bad(moveParams("ghost"))).toContain("nao tem fisica");
    expect(bad(moveParams("fox", { speed: 0 }))).toContain("entre 1 e 8");
    expect(bad(moveParams("fox", { jump_button: "BUTTON_RIGHT" }))).toContain("mesmo botao");
    expect(bad(moveParams("fox", { jump_sound: "boom" }))).toContain('"boom" nao existe');
    expect(bad(moveParams("fox", { jump_animation: "fly" }))).toContain('nao tem a animacao "fly"');
    const passage = (params: Record<string, string | number>) => planApplyBehavior(EMPTY, "gated_passage", params, context).errors.join(" | ");
    expect(passage({ movement: "x", blocker: "gate", state_variable: "score", threshold: 5 })).toContain("Movimento bloqueado");
    const moved = apply(EMPTY, "platform_movement", moveParams("fox"));
    expect(planApplyBehavior(moved.graph, "gated_passage", { movement: moved.id, blocker: "fox", state_variable: "score", threshold: 5 }, context).errors.join()).toContain("bloquear a si mesma");
    expect(planApplyBehavior(moved.graph, "gated_passage", { movement: moved.id, blocker: "gate", state_variable: "nobody_writes", threshold: 5 }, context).errors.join()).toContain("nunca seria alcancado");
    expect(planApplyBehavior(moved.graph, "gated_passage", { movement: moved.id, blocker: "gate", state_variable: "score", threshold: -1 }, context).errors.join()).toContain("entre 0 e 32767");
  });

  it("refuses the grounded jump on SNES but keeps movement without jump", () => {
    const snes = { ...context, platform: "snes" };
    expect(planApplyBehavior(EMPTY, "platform_movement", moveParams("fox"), snes).errors.join()).toContain("SNES");
    expect(planApplyBehavior(EMPTY, "platform_movement", moveParams("fox", { jump_button: "" }), snes).errors).toEqual([]);
  });

  it("warns before duplicating logic on the same entity", () => {
    const first = apply(EMPTY, "platform_movement", moveParams("fox"));
    const again = planApplyBehavior(first.graph, "platform_movement", moveParams("fox"), context);
    expect(again.conflicts).toEqual([expect.objectContaining({ kind: "duplicate" })]);
    const manual: NodeGraph = deserializeNodeGraph(
      JSON.stringify({ version: 1, nodes: [{ id: "m", type: "sprite_move", label: "m", x: 0, y: 0, params: { target: "fox", dx: 2 } }], edges: [] })
    );
    expect(planApplyBehavior(manual, "platform_movement", moveParams("fox"), context).conflicts).toEqual([expect.objectContaining({ kind: "manual_logic" })]);
  });

  it("gates the movement with an instance-private state and restores it on removal", () => {
    const moved = apply(EMPTY, "platform_movement", moveParams("fox"));
    const gated = apply(moved.graph, "gated_passage", { movement: moved.id, blocker: "gate", state_variable: "score", threshold: 12 });
    const open = passageOpenVariable(gated.id);
    expect(gated.graph.nodes.find((node) => node.id === `${gated.id}__open`)!.params.var_name).toBe(open);
    // O caminho direto input->mover foi substituido pela porta.
    expect(gated.graph.edges.some((edge) => edge.fromNode === `${moved.id}__right_input` && edge.toNode === `${moved.id}__right_move`)).toBe(false);
    expect(gated.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNode: `${moved.id}__right_input`, toNode: `${gated.id}__right_gate` }),
      expect.objectContaining({ fromNode: `${gated.id}__right_gate`, fromPort: "false", toNode: `${moved.id}__right_move` }),
      expect.objectContaining({ fromNode: `${gated.id}__right_open_check`, fromPort: "true", toNode: `${moved.id}__right_move` }),
    ]));
    // Dependencia: nao remove o movimento enquanto a passagem existir.
    expect(planRemoveBehavior(gated.graph, moved.id).errors.join()).toContain("depende");
    // Editar o movimento reaplica a passagem (sem perder a porta).
    const faster = planEditBehavior(gated.graph, moved.id, { ...gated.graph.behaviors![0].params, speed: 4 }, context).graph!;
    expect(faster.nodes.find((node) => node.id === `${gated.id}__right_gate`)!.params.probe_dx).toBe(4);
    // Remover a passagem restaura exatamente o movimento original.
    const removed = planRemoveBehavior(faster, gated.id).graph!;
    const reference = planEditBehavior(moved.graph, moved.id, { ...moved.graph.behaviors![0].params, speed: 4 }, context).graph!;
    expect(graphSemanticSignature(removed)).toBe(graphSemanticSignature(reference));
    expect(removed.nodes.some((node) => String(node.params.var_name ?? "") === open)).toBe(false);
  });

  it("chains several passages on the same movement and removes them in any order without orphans", () => {
    const ctx = buildBehaviorSceneContext(
      [...context.entities.map((entity) => ({ entity_id: entity.id, components: { sprite: entity.hasSprite ? sprite(entity.animations) : undefined, physics: entity.hasPhysics ? {} : undefined, collision: entity.hasCollision ? {} : undefined } })),
        { entity_id: "gate_2", components: { collision: {} } }],
      [{ nodes: [{ id: "s", type: "var_set", label: "s", x: 0, y: 0, inputs: [], outputs: [], params: { var_name: "score", value: 0 } }], edges: [] }]
    );
    const moved = apply(EMPTY, "platform_movement", moveParams("fox"));
    const inner = planApplyBehavior(moved.graph, "gated_passage", { movement: moved.id, blocker: "gate", state_variable: "score", threshold: 20 }, ctx);
    const outer = planApplyBehavior(inner.graph!, "gated_passage", { movement: moved.id, blocker: "gate_2", state_variable: "score", threshold: 20 }, ctx);
    const g = outer.graph!;
    const to = (from: string, port = "exec") => g.edges.filter((edge) => edge.fromNode === from && edge.fromPort === port).map((edge) => edge.toNode);
    for (const side of ["right", "left"]) {
      // entrada -> porta externa -> (livre) porta interna -> (livre) mover; cada porta gate so abre pelo seu estado.
      expect(to(`${moved.id}__${side}_input`)).toEqual([`${outer.instanceId}__${side}_gate`]);
      expect(to(`${outer.instanceId}__${side}_gate`, "false")).toEqual([`${inner.instanceId}__${side}_gate`]);
      expect(to(`${outer.instanceId}__${side}_open_check`, "true")).toEqual([`${inner.instanceId}__${side}_gate`]);
      expect(to(`${inner.instanceId}__${side}_gate`, "false")).toEqual([`${moved.id}__${side}_move`]);
    }
    // Estados privados distintos.
    expect(new Set(g.nodes.filter((node) => node.type === "var_set").map((node) => node.params.var_name)).size).toBe(2);
    const noOrphans = (graph: NodeGraph) => {
      const ids = new Set(graph.nodes.map((node) => node.id));
      return graph.edges.every((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode));
    };
    // Remover a interna primeiro: a externa passa a envolver o mover.
    const withoutInner = planRemoveBehavior(g, inner.instanceId!).graph!;
    expect(noOrphans(withoutInner)).toBe(true);
    const to2 = (graph: NodeGraph, from: string, port = "exec") => graph.edges.filter((edge) => edge.fromNode === from && edge.fromPort === port).map((edge) => edge.toNode);
    expect(to2(withoutInner, `${outer.instanceId}__right_gate`, "false")).toEqual([`${moved.id}__right_move`]);
    expect(to2(withoutInner, `${outer.instanceId}__right_open_check`, "true")).toEqual([`${moved.id}__right_move`]);
    const bothGone = planRemoveBehavior(withoutInner, outer.instanceId!).graph!;
    expect(graphSemanticSignature(bothGone)).toBe(graphSemanticSignature(moved.graph));
    // Ordem inversa tambem restaura exatamente o original.
    const outerFirst = planRemoveBehavior(planRemoveBehavior(g, outer.instanceId!).graph!, inner.instanceId!).graph!;
    expect(graphSemanticSignature(outerFirst)).toBe(graphSemanticSignature(moved.graph));
    // Editar o movimento reaplica as duas passagens, mantendo a cadeia.
    const edited = planEditBehavior(g, moved.id, { ...g.behaviors![0].params, speed: 8 }, ctx).graph!;
    expect(to2(edited, `${moved.id}__right_input`)).toEqual([`${outer.instanceId}__right_gate`]);
    expect(edited.nodes.find((node) => node.id === `${inner.instanceId}__right_gate`)!.params.probe_dx).toBe(8);
    expect(noOrphans(edited)).toBe(true);
  });

  it("detects manual edits before regenerating and keeps manual connections that still fit", () => {
    const moved = apply(EMPTY, "platform_movement", moveParams("fox"));
    const touched: NodeGraph = {
      ...moved.graph,
      nodes: moved.graph.nodes.map((node) => (node.id === `${moved.id}__jump_velocity` ? { ...node, params: { ...node.params, vy: -10 } } : node)),
    };
    expect(manuallyEditedNodes(touched, touched.behaviors![0]).map((node) => node.id)).toEqual([`${moved.id}__jump_velocity`]);
    const plan = planEditBehavior(touched, moved.id, { ...touched.behaviors![0].params, speed: 2 }, context);
    expect(plan.conflicts).toEqual([expect.objectContaining({ kind: "manual_edit" })]);
    expect(plan.graph!.nodes.find((node) => node.id === `${moved.id}__jump_velocity`)!.params.vy).toBe(-64);
  });

  it("removing one instance preserves the other untouched", () => {
    const a = apply(EMPTY, "platform_movement", moveParams("fox"));
    const b = apply(a.graph, "platform_movement", moveParams("fox_2", { speed: 3 }));
    const removed = planRemoveBehavior(b.graph, a.id).graph!;
    expect(removed.behaviors!.map((instance) => instance.id)).toEqual([b.id]);
    expect(removed.nodes.every((node) => node.params.behavior_instance === b.id)).toBe(true);
    const only = apply(EMPTY, "platform_movement", moveParams("fox_2", { speed: 3 }));
    // Mesmo conteudo que aplicar so a segunda (ids diferem so pelo contador; comparar papeis).
    const roles = (graph: NodeGraph) => graph.nodes.map((node) => [node.params.behavior_role, node.params.target ?? null, node.params.dx ?? null]).sort();
    expect(roles(removed)).toEqual(roles(only.graph));
  });

  it("duplicates an entity's behaviors with remapped ids/targets/state and explicit external refs", () => {
    const moved = apply(EMPTY, "platform_movement", moveParams("fox"));
    const gated = apply(moved.graph, "gated_passage", { movement: moved.id, blocker: "gate", state_variable: "score", threshold: 12 });
    const manual: NodeGraph = {
      ...gated.graph,
      nodes: [...gated.graph.nodes, { ...gated.graph.nodes[0], id: "manual_only", params: { rate: "frame" } }],
    };
    const copy = duplicateBehaviorLogic(manual, "fox", "fox_2", [moved.id, gated.id]);
    expect(copy.droppedManualNodes).toBe(1);
    const ids = copy.graph.behaviors!.map((instance) => instance.id);
    expect(ids.some((id) => id === moved.id || id === gated.id)).toBe(false);
    // Nenhum id do original sobrevive na copia; o alvo virou fox_2; a porta usa a copia do movimento.
    const originalIds = new Set(manual.nodes.map((node) => node.id));
    expect(copy.graph.nodes.some((node) => originalIds.has(node.id))).toBe(false);
    expect(copy.graph.nodes.filter((node) => node.type === "sprite_move").every((node) => node.params.target === "fox_2")).toBe(true);
    const copiedPassage = copy.graph.behaviors!.find((instance) => instance.behaviorId === "gated_passage")!;
    const copiedMove = copy.graph.behaviors!.find((instance) => instance.behaviorId === "platform_movement")!;
    expect(copiedPassage.params.movement).toBe(copiedMove.id);
    // Estado privado renomeado (sem estado compartilhado); externos mantidos e listados.
    const openVars = copy.graph.nodes.filter((node) => node.type === "var_set").map((node) => node.params.var_name);
    expect(openVars).toEqual([passageOpenVariable(copiedPassage.id)]);
    expect(openVars).not.toContain(passageOpenVariable(gated.id));
    expect(copy.graph.nodes.find((node) => node.type === "destroy_entity")!.params.target).toBe("gate");
    expect(copy.preservedExternal).toEqual(expect.arrayContaining(["entidade gate", "variavel score"]));
    // Arestas apontam so para nos existentes (sem orfaos) e a copia e valida ao reabrir.
    const present = new Set(copy.graph.nodes.map((node) => node.id));
    expect(copy.graph.edges.every((edge) => present.has(edge.fromNode) && present.has(edge.toNode))).toBe(true);
    const ctx2 = buildBehaviorSceneContext(
      [...context.entities.map((entity) => ({ entity_id: entity.id, components: { sprite: entity.hasSprite ? sprite(entity.animations) : undefined, physics: entity.hasPhysics ? {} : undefined, collision: entity.hasCollision ? {} : undefined } }))],
      [manual]
    );
    expect(validateBehaviorInstances(deserializeNodeGraph(serializeNodeGraph(copy.graph)), ctx2)).toEqual([]);
    expect(manuallyEditedNodes(copy.graph, copiedMove)).toEqual([]);
  });

  it("reports orphan references after reopening", () => {
    const moved = apply(EMPTY, "platform_movement", moveParams("fox_2"));
    const without = buildBehaviorSceneContext([{ entity_id: "fox", components: { sprite: sprite() } }], []);
    expect(validateBehaviorInstances(moved.graph, without)).toEqual([expect.objectContaining({ message: expect.stringContaining('"fox_2" nao existe mais') })]);
  });
});
