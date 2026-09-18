import { runEngine, type EngineState } from "../api";

/** Jarvis 判断顺序引擎（原地更新） */
export default function EngineWidget({ state, update }: {
  state: EngineState; update: (p: Partial<EngineState>) => void;
}) {
  const eng = runEngine(state);
  return (
    <div className="engine">
      <div className="engine-row">
        <label>当前精力 <b className="mono">{state.energy}/5</b></label>
        <input type="range" min={1} max={5} step={1} value={state.energy}
          onChange={e => update({ energy: +e.target.value })} aria-label="当前精力" />
      </div>
      <div className="engine-row">
        <label>昨晚睡眠 <b className="mono">{state.sleep}h</b></label>
        <input type="range" min={3} max={10} step={0.5} value={state.sleep}
          onChange={e => update({ sleep: +e.target.value })} aria-label="昨晚睡眠小时数" />
      </div>
      <div className="engine-row switches">
        <button className={`switch ${state.redFlag ? "on" : ""}`} onClick={() => update({ redFlag: !state.redFlag })}>🚑 健康红灯</button>
        <button className={`switch ${state.fixed ? "on" : ""}`} onClick={() => update({ fixed: !state.fixed })}>📅 固定安排</button>
        <button className={`switch ${state.budget ? "on" : ""}`} onClick={() => update({ budget: !state.budget })}>💰 预算紧张</button>
      </div>
      <div className="verdict" role="status">
        <div className="v-main">{eng.firstName}</div>
        <div className="v-sub">{eng.verdict}</div>
        <div className="v-plan" dangerouslySetInnerHTML={{ __html: eng.plan }} />
      </div>
    </div>
  );
}
