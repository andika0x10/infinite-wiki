"use client";

import { useId } from "react";
import type { Topic } from "@/lib/topics";

export function TopicPath({ topic }: { topic: Topic }) {
  const id = useId();
  const ancestors = topic.path.length > 1 ? topic.path.slice(0, -1) : topic.path;
  const short = ancestors.slice(-2);
  return (
    <div className="topic-path">
      <nav aria-label="Asal cabang">
        <ol>
          {short.map((part, index) => (
            <li key={`${index}-${part}`}>{part}</li>
          ))}
        </ol>
      </nav>
      {ancestors.length > 2 && (
        <details className="full-path">
          <summary aria-controls={id}>Lihat jalur</summary>
          <ol id={id}>
            {topic.path.map((part, index) => (
              <li key={`${index}-${part}`}>{part}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
