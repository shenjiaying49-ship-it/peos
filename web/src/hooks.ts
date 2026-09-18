import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEFAULT_ENGINE, type EngineState, type Finance, type Overview } from "./api";

export function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.overview().then(d => {
      if (d && (d as any).error) setError((d as any).error);
      else setData(d);
    }).catch(e => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  /* 自动检测日期变更：每 30s 对比一次，跨天后自动刷新 */
  useEffect(() => {
    const check = () => {
      setData(prev => {
        if (!prev) return prev;
        const localDate = new Date().toISOString().slice(0, 10);
        if (prev.today !== localDate) {
          api.overview().then(d => {
            if (d && !(d as any).error) setData(d);
          }).catch(() => {});
        }
        return prev;
      });
    };
    const iv = setInterval(check, 30_000);
    /* 页面可见时也检测一次 */
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return { data, error, reload: load };
}

const ENGINE_KEY = "peos.engine.state";

export function useEngine() {
  const [state, setState] = useState<EngineState>(() => {
    try { return { ...DEFAULT_ENGINE, ...JSON.parse(localStorage.getItem(ENGINE_KEY) || "{}") }; }
    catch { return DEFAULT_ENGINE; }
  });
  const update = (patch: Partial<EngineState>) => setState(s => {
    const next = { ...s, ...patch };
    localStorage.setItem(ENGINE_KEY, JSON.stringify(next));
    return next;
  });
  return { state, update };
}

export function useFinance() {
  const [data, setData] = useState<Finance | null>(null);
  const load = useCallback(() => { api.finance().then(setData).catch(() => {}); }, []);
  useEffect(load, [load]);
  return { data, reload: load };
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setReduced(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

/* 桌面鼠标视差：返回随 lerp 平滑的 [x, y]（-1..1），reduced/触屏为 0 */
export function useMouseParallax(enabled: boolean) {
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      target.current = {
        x: (e.clientX / innerWidth - 0.5) * 2,
        y: (e.clientY / innerHeight - 0.5) * 2,
      };
    };
    const loop = () => {
      const c = current.current, t = target.current;
      c.x += (t.x - c.x) * 0.06;
      c.y += (t.y - c.y) * 0.06;
      setPos({ x: +c.x.toFixed(4), y: +c.y.toFixed(4) });
      raf = requestAnimationFrame(loop);
    };
    addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(loop);
    return () => { removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, [enabled]);
  return pos;
}

/* 去抖刷新（勾选/记账后） */
export function useDebouncedReload(reload: () => void, ms = 700) {
  const t = useRef<number | undefined>(undefined);
  return useCallback(() => {
    clearTimeout(t.current);
    t.current = window.setTimeout(reload, ms);
  }, [reload, ms]);
}
