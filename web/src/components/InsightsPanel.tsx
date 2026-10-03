import { useEffect, useState } from "react";
import { api } from "../api";

/** 近 7 天生活信号：睡眠 / 日记缺口 / 完成率 / 运动 / 超支 / 最弱象限。
 *  数据来自 Daily 回填与日记 —— 是「系统懂你」的反馈回路，挂今日右栏。 */
export default function InsightsPanel() {
  const [signals, setSignals] = useState<{ icon: string; text: string }[]>([]);

  const load = () => { api.insights(7).then(r => { if (r.ok) setSignals(r.signals || []); }).catch(() => {}); };
  useEffect(load, []);

  if (!signals.length) return null;

  return (
    <div className="insights" data-reveal>
      {signals.map((s, i) => (
        <div key={i} className="ins-row">
          <span className="ins-icon">{s.icon}</span>
          <span className="ins-text">{s.text}</span>
        </div>
      ))}
    </div>
  );
}
