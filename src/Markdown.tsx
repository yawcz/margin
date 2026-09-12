import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
export default function Markdown({
  children,
  onPage,
}: {
  children: string;
  onPage?: (page: number) => void;
}) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const page = href?.match(/^#page=(\d+)$/);
            return page ? (
              <button className="page-citation" onClick={() => onPage?.(Number(page[1]))}>
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
