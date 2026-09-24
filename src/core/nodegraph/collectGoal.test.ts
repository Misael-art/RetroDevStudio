import { describe, expect, it } from "vitest";

import {
  buildBehaviorSceneContext,
  counterVariable,
  duplicateBehaviorLogic,
  instanceFlagVariable,
  planApplyBehavior,
  planEditBehavior,
  planRemoveBehavior,
  validateBehaviorInstances,
  type BehaviorParams,
} from "./behaviorLibrary";
import { deserializeNodeGraph } from "./nodeDefinitions";
import { serializeNodeGraph, type NodeGraph } from "./nodeTypes";

const sprite = { animations: {}, asset: "assets/sprites/coin.png", frame_width: 16, frame_height: 16 };
const entities = [
  { entity_id: "player", display_name: "Raposa", components: { sprite, physics: {}, collision: {}, audio: { sfx: { coin: "c.wav", victory: "v.wav" } } } },
  { entity_id: "coin_1", display_name: "Moeda 1", components: { sprite, collision: {} } },
  { entity_id: "coin_2", display_name: "Moeda 2", components: { sprite, collision: {} } },
  { entity_id: "enemy", display_name: "Inimigo", components: { sprite, collision: {} } },
  { entity_id: "goal_sensor", display_name: "Sensor", components: { collision: {} } },
  { entity_id: "flag", display_name: "Bandeira", components: { sprite } },
];
const EMPTY: NodeGraph = { nodes: [], edges: [] };
/** Grafos por entidade (mesma ordem de `entities`). */
type Scene = Record<string, NodeGraph>;
const ctx = (scene: Scene, platform: string | null = "megadrive") =>
  buildBehaviorSceneContext(entities, entities.map((entity) => scene[entity.entity_id] ?? EMPTY), platform);
function apply(scene: Scene, host: string, behaviorId: string, params: BehaviorParams) {
  const plan = planApplyBehavior(scene[host] ?? EMPTY, behaviorId, params, ctx(scene));
  expect(plan.errors).toEqual([]);
  return { scene: { ...scene, [host]: plan.graph! }, id: plan.instanceId!, plan };
}
const node = (graph: NodeGraph, id: string) => graph.nodes.find((candidate) => candidate.id === id)!;
const to = (graph: NodeGraph, from: string, port = "exec") => graph.edges.filter((edge) => edge.fromNode === from && edge.fromPort === port).map((edge) => edge.toNode);

function buildScene() {
  let scene: Scene = {};
  const counter = apply(scene, "player", "counter", { name: "Moedas", scope: "shared", owner: "", start: 0 });
  scene = counter.scene;
  const coin1 = apply(scene, "coin_1", "collectible", { item: "coin_1", collector: "player", counter: counter.id, amount: 1, sound: "coin" });
  scene = coin1.scene;
  const coin2 = apply(scene, "coin_2", "collectible", { item: "coin_2", collector: "player", counter: counter.id, amount: 1, sound: "" });
  scene = coin2.scene;
  return { scene, counter, coin1, coin2 };
}

describe("collect -> counter -> passage -> objective", () => {
  it("credits exactly once per item, only for the explicit collector, into the chosen counter", () => {
    const { scene, counter, coin1, coin2 } = buildScene();
    const varName = counterVariable({ name: "Moedas", scope: "shared" });
    expect(varName).toBe("ctr_moedas");
    // Contador: volta ao valor inicial a cada partida.
    expect(to(scene.player, `${counter.id}__start_tick`)).toEqual([`${counter.id}__reset`]);
    expect(node(scene.player, `${counter.id}__reset`).params).toMatchObject({ var_name: varName, value: 0 });
    const g = scene.coin_1;
    // Coletor explicito (negativo "coletor errado": so player/coin_1 no overlap).
    expect(node(g, `${coin1.id}__touch`).params).toMatchObject({ a: "player", b: "coin_1" });
    // Credito uma unica vez: overlap -> (marca == 0) -> marcar -> somar -> esconder -> som.
    expect(to(g, `${coin1.id}__touch`, "true")).toEqual([`${coin1.id}__not_taken`]);
    expect(to(g, `${coin1.id}__not_taken`, "true")).toEqual([`${coin1.id}__mark`]);
    expect(to(g, `${coin1.id}__not_taken`, "false")).toEqual([]);
    expect(to(g, `${coin1.id}__mark`)).toEqual([`${coin1.id}__add`]);
    expect(to(g, `${coin1.id}__add`)).toEqual([`${coin1.id}__hide`]);
    expect(to(g, `${coin1.id}__hide`)).toEqual([`${coin1.id}__sound`]);
    expect(node(g, `${coin1.id}__add`).params.var_name).toBe(varName);
    expect(node(g, `${coin1.id}__hide`).params.target).toBe("coin_1"); // alvo correto
    // Marca privada por item, reiniciada a cada partida.
    const taken1 = instanceFlagVariable(coin1.id, "taken");
    const taken2 = instanceFlagVariable(coin2.id, "taken");
    expect(taken1).not.toBe(taken2);
    expect(node(g, `${coin1.id}__reset`).params).toMatchObject({ var_name: taken1, value: 0 });
    expect(node(scene.coin_2, `${coin2.id}__mark`).params.var_name).toBe(taken2);
    // Painel: contador alimentado pelos dois itens.
    const context = ctx(scene);
    expect(context.references!.filter((reference) => reference.refs.includes(counter.id)).map((reference) => reference.hostEntity).sort()).toEqual(["coin_1", "coin_2"]);
    expect(context.variableLabels![varName]).toBe('Contador "Moedas"');
  });

  it("opens a passage and fires the objective only when the counter condition holds", () => {
    const built = buildScene();
    const counter = built.counter;
    let scene = built.scene;
    const move = apply(scene, "player", "platform_movement", { target: "player", speed: 2, right_button: "BUTTON_RIGHT", left_button: "BUTTON_LEFT", jump_button: "BUTTON_A", jump_strength: 64, jump_animation: "", jump_sound: "" });
    scene = move.scene;
    const gate = apply(scene, "player", "gated_passage", { movement: move.id, blocker: "enemy", state_variable: "ctr_moedas", threshold: 2 });
    scene = gate.scene;
    expect(node(scene.player, `${gate.id}__rule_value`).params.var_name).toBe("ctr_moedas");
    expect(node(scene.player, `${gate.id}__rule`).params).toMatchObject({ operator: ">=", b: 2 });
    const goal = apply(scene, "player", "objective", { actor: "player", sensor: "goal_sensor", counter: counter.id, required: 2, reveal: "flag", sound: "victory" });
    scene = goal.scene;
    const g = scene.player;
    // Negativo "vitoria prematura": chegar ao sensor so marca depois de contador >= 2.
    expect(to(g, `${goal.id}__not_done`, "true")).toEqual([`${goal.id}__enough`]);
    expect(to(g, `${goal.id}__enough`, "true")).toEqual([`${goal.id}__mark`]);
    expect(to(g, `${goal.id}__enough`, "false")).toEqual([]);
    expect(node(g, `${goal.id}__enough`).params).toMatchObject({ operator: ">=", b: 2 });
    // Uma unica vez por partida.
    expect(node(g, `${goal.id}__reset`).params).toMatchObject({ var_name: instanceFlagVariable(goal.id, "done"), value: 0 });
    expect(to(g, `${goal.id}__mark`)).toEqual([`${goal.id}__reveal`]);
    expect(node(g, `${goal.id}__reveal`).params.target).toBe("flag");
    // Persistencia e reabertura sem referencias orfas.
    const reopened: Scene = Object.fromEntries(Object.entries(scene).map(([id, graph]) => [id, deserializeNodeGraph(serializeNodeGraph(graph))]));
    for (const [id, graph] of Object.entries(reopened)) expect(validateBehaviorInstances(graph, ctx(reopened)), id).toEqual([]);
  });

  it("refuses invalid references and wrong targets with useful messages", () => {
    const { scene, counter } = buildScene();
    const errors = (host: string, behaviorId: string, params: BehaviorParams) => planApplyBehavior(scene[host] ?? EMPTY, behaviorId, params, ctx(scene)).errors.join(" | ");
    expect(errors("coin_1", "collectible", { item: "coin_1", collector: "coin_1", counter: counter.id, amount: 1, sound: "" })).toContain("coletar a si mesmo");
    expect(errors("coin_1", "collectible", { item: "coin_1", collector: "player", counter: "bh_ctr_gone", amount: 1, sound: "" })).toContain("nao existe mais");
    expect(errors("coin_1", "collectible", { item: "ghost", collector: "player", counter: counter.id, amount: 1, sound: "" })).toContain('"ghost" nao existe');
    expect(errors("coin_1", "collectible", { item: "coin_1", collector: "player", counter: counter.id, amount: 0, sound: "" })).toContain("entre 1 e 99");
    expect(errors("player", "objective", { actor: "player", sensor: "player", counter: "", required: 0, reveal: "", sound: "" })).toContain("proprio sensor");
    expect(errors("player", "counter", { name: "Moedas", scope: "shared", owner: "", start: 0 })).toContain("ja existe o contador");
    expect(errors("player", "counter", { name: "Vidas", scope: "entity", owner: "", start: 3 })).toContain("Entidade dona");
  });

  it("refuses removing a counter used in other entities and renaming it under them", () => {
    const { scene, counter } = buildScene();
    const refused = planRemoveBehavior(scene.player, counter.id, ctx(scene));
    expect(refused.ok).toBe(false);
    expect(refused.errors.join()).toContain("Moeda 1");
    expect(refused.errors.join()).toContain("Moeda 2");
    const renamed = planEditBehavior(scene.player, counter.id, { name: "Ouro", scope: "shared", owner: "", start: 0 }, ctx(scene));
    expect(renamed.errors.join()).toContain("troca a variavel");
    // Grafo alterado por fora (contador apagado sem passar pela UI): referencia orfa apontada.
    const withoutCounter: Scene = { ...scene, player: EMPTY };
    expect(validateBehaviorInstances(scene.coin_1, ctx(withoutCounter)).map((issue) => issue.message).join()).toContain("nao existe mais");
    // Mudar so o valor inicial e permitido.
    expect(planEditBehavior(scene.player, counter.id, { name: "Moedas", scope: "shared", owner: "", start: 5 }, ctx(scene)).errors).toEqual([]);
  });

  it("duplicating an item gives the copy its own 'already collected' flag and keeps the shared counter", () => {
    const { scene, counter, coin1 } = buildScene();
    const copy = duplicateBehaviorLogic(scene.coin_1, "coin_1", "coin_1_2", ctx(scene).instanceIds);
    const copied = copy.graph.behaviors![0];
    expect(copied.id).not.toBe(coin1.id);
    expect(copied.params).toMatchObject({ item: "coin_1_2", collector: "player", counter: counter.id });
    const flags = copy.graph.nodes.filter((candidate) => candidate.type === "var_set" && String(candidate.params.var_name).endsWith("_taken")).map((candidate) => candidate.params.var_name);
    expect(new Set(flags)).toEqual(new Set([instanceFlagVariable(copied.id, "taken")]));
    expect(flags).not.toContain(instanceFlagVariable(coin1.id, "taken"));
    expect(copy.graph.nodes.find((candidate) => candidate.type === "destroy_entity")!.params.target).toBe("coin_1_2");
    // O contador compartilhado nao e duplicado quando a entidade dona e copiada.
    const hostCopy = duplicateBehaviorLogic(scene.player, "player", "player_2", ctx(scene).instanceIds);
    expect(hostCopy.graph.behaviors ?? []).toEqual([]);
    expect(hostCopy.preservedExternal).toContain("contador compartilhado Moedas");
  });

  it("gives an entity-owned counter its own variable per owner", () => {
    const shared = counterVariable({ name: "Vidas", scope: "shared" });
    const own = counterVariable({ name: "Vidas", scope: "entity", owner: "player" });
    const own2 = counterVariable({ name: "Vidas", scope: "entity", owner: "player_2" });
    expect(new Set([shared, own, own2]).size).toBe(3);
  });
});
