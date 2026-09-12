import { useEffect, useId, useRef, useState } from 'react';
import Markdown from './Markdown';

// Preserve the full Markdown (including equations and citations) when folding old or long replies.
export default function Answer({
  content,
  onPage,
}: {
  content: string;
  onPage: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const inner = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const observer = new ResizeObserver(() => setLong((inner.current?.scrollHeight ?? 0) > 256));
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [content]);
  return (
    <div className="answer" ref={wrapper}>
      <div
        id={id}
        className={`answer-body ${long && !expanded ? 'folded' : ''}`}
        onFocusCapture={(e) => {
          if (
            !expanded &&
            e.target.getBoundingClientRect().bottom >
              e.currentTarget.getBoundingClientRect().bottom - 32
          )
            setExpanded(true);
        }}
      >
        <div ref={inner}>
          <Markdown onPage={onPage}>{content}</Markdown>
        </div>
      </div>
      {long && (
        <button
          className="text-button answer-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            setExpanded(!expanded);
            if (expanded) wrapper.current?.scrollIntoView({ block: 'nearest' });
          }}
        >
          {expanded ? 'Show less' : 'Show full answer'}
        </button>
      )}
    </div>
  );
}
