import { useEffect, useState } from "react";
import { api } from "../api";

interface Att {
  course: string; attended: number; sessions_elapsed: number; sessions_total: number;
  required: number; missed: number; projected: number; will_meet: boolean; status: string; note: string;
}

/** 结课要求达成度：出勤硬门槛（数据源 course_requirements.json + vault 勾选记录） */
export default function CourseGates() {
  const [items, setItems] = useState<Att[]>([]);

  useEffect(() => {
    api.courseProgress().then(r => { if (r.ok) setItems(r.attendance || []); }).catch(() => {});
  }, []);

  if (!items.length) return null;

  return (
    <div className="gates">
      {items.map(a => {
        const pct = Math.min(100, Math.round((a.attended / a.required) * 100));
        return (
          <div key={a.course} className={`gate-row ${a.status}`}>
            <span className="g-course mono">{a.course}</span>
            <span className="g-bar"><i style={{ width: `${pct}%` }} /></span>
            <span className="g-num mono">
              {a.attended}/{a.required}
              {a.missed > 0 && <em className="g-missed"> 旷 {a.missed}</em>}
            </span>
            <span className="g-note">
              {a.status === "danger"
                ? `按现在的节奏到学期末只有 ${a.projected} 次，门槛 ${a.required} 次达不到`
                : a.missed > 0 ? a.note : a.note}
            </span>
          </div>
        );
      })}
    </div>
  );
}
