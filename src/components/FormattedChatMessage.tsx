import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface FormattedChatMessageProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * FormattedChatMessage
 * Enterprise Senior-level Markdown and UI Renderer for Hema Assistant.
 * Transforms raw markdown, bullet points, headers, tables, and currency data
 * into clean, mobile-first, beautifully styled UI elements with zero raw asterisks.
 */
export const FormattedChatMessage: React.FC<FormattedChatMessageProps> = memo(({
  content,
  isStreaming = false,
  className
}) => {
  if (!content) {
    return isStreaming ? (
      <span className="inline-flex items-center space-x-1 py-1">
        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse delay-150" />
        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse delay-300" />
      </span>
    ) : null;
  }

  // Pre-process raw text to clean up any odd trailing markdown artifacts or redundant divider asterisks
  const sanitizedContent = content
    .replace(/^(\s*\*\s*\*\s*\*|\s*-\s*-\s*-)+$/gm, '---')
    .trim();

  return (
    <div className={cn("text-xs sm:text-sm text-slate-800 leading-relaxed font-sans space-y-2 select-text", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-sm sm:text-base font-extrabold text-primary-950 mt-2 mb-1.5 pb-1 border-b border-primary-200/60 flex items-center gap-1.5">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xs sm:text-sm font-bold text-primary-900 mt-2 mb-1 pb-0.5 border-b border-primary-100 flex items-center gap-1.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs sm:text-sm font-bold text-primary-900 mt-1.5 mb-1 text-primary-800">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-bold text-primary-800 mt-1 mb-0.5">
              {children}
            </h4>
          ),

          // Paragraphs & Text
          p: ({ children }) => (
            <p className="mb-1.5 last:mb-0 leading-relaxed text-slate-800 break-words">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-slate-950 text-[13px] sm:text-[14px]">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-slate-600 text-[11px] sm:text-xs">
              {children}
            </em>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="space-y-1.5 my-1.5 pl-0.5 list-none">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1.5 my-1.5 pl-4 text-slate-800 marker:font-bold marker:text-primary-700">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="flex items-start gap-2 text-xs sm:text-sm text-slate-800 leading-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0" />
              <div className="flex-1 break-words">{children}</div>
            </li>
          ),

          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-2.5 rounded-xl border border-primary-200/90 shadow-2xs bg-white">
              <table className="w-full min-w-[340px] text-left text-xs divide-y divide-primary-100">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-primary-100/80 text-primary-950 font-extrabold border-b border-primary-200">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-primary-100/60 bg-white">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-primary-50/40 transition-colors odd:bg-white even:bg-slate-50/40">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-[10px] sm:text-[11px] font-extrabold text-primary-950 tracking-wide uppercase whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-xs text-slate-800 font-medium whitespace-nowrap">
              {children}
            </td>
          ),

          // Horizontal dividers
          hr: () => (
            <hr className="my-2.5 border-t border-primary-200/70" />
          ),

          // Blockquotes / Notes / Regulatory disclaimers
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-primary-500 pl-3 py-1.5 my-2 bg-primary-50/50 rounded-r-xl text-xs text-slate-700 italic">
              {children}
            </blockquote>
          ),

          // Code blocks & inline code
          code: ({ children, className: codeClass }: any) => {
            const isMultiline = String(children).includes('\n');
            if (isMultiline) {
              return (
                <pre className="p-3 my-2 rounded-xl bg-slate-900 text-slate-100 text-xs overflow-x-auto font-mono">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="bg-primary-50 text-primary-800 px-1.5 py-0.5 rounded text-[11px] font-mono border border-primary-200/60 font-semibold">
                {children}
              </code>
            );
          },

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-700 hover:text-primary-800 underline font-semibold transition-colors"
            >
              {children}
            </a>
          )
        }}
      >
        {sanitizedContent}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-primary-600 animate-pulse ml-0.5 align-middle rounded-xs" />
      )}
    </div>
  );
});

FormattedChatMessage.displayName = 'FormattedChatMessage';
