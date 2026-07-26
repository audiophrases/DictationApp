import { ExternalLink, BookOpen } from 'lucide-react';

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Attribution for an auto-fetched passage: title, source name, the text's
 * last-updated date, and a link so the user can read the original.
 */
function SourceCitation({ source, compact }) {
  if (!source) return null;
  const date = formatDate(source.date);

  return (
    <div className={`source-card ${compact ? 'source-card-compact' : ''}`}>
      <BookOpen size={16} className="source-icon" />
      <div className="source-text">
        <span className="source-title">{source.title}</span>
        <span className="source-meta">
          {source.source}
          {date ? ` · updated ${date}` : ''}
        </span>
      </div>
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-link" title="Read the original">
          Read <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

export default SourceCitation;
