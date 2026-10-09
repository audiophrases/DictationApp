import { useId } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

// The three grading options, as an explicit choice per rule. They used to be
// chips labelled "Ignore case" and so on, where a lit chip meant "ignored" —
// a double negative that left teachers unsure whether punctuation was being
// marked or not. Here both answers are always on screen, the chosen one is
// filled in, and an example under each rule spells out what it does to an
// answer. Shared by the teacher's assignment form and the practice results
// screen, so the two can't drift into describing one option two ways.
const RULES = [
  { key: 'ignoreCase', name: 'Capital letters', expected: 'Paris', typed: 'paris' },
  { key: 'ignorePunctuation', name: 'Punctuation', expected: 'Yes, please.', typed: 'Yes please' },
  { key: 'ignoreAccents', name: 'Accents', expected: 'café', typed: 'cafe' },
];

function MarkingRules({ value, onChange }) {
  const id = useId();
  return (
    <div className="marking-rules">
      {RULES.map((rule) => {
        const ignored = !!value[rule.key];
        const set = (next) => onChange({ ...value, [rule.key]: next });
        return (
          <div key={rule.key} className="rule-row">
            <div className="rule-text">
              <div className="rule-name">{rule.name}</div>
              <div className={`rule-example ${ignored ? 'badge-good' : 'badge-poor'}`}>
                {ignored ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>
                  “{rule.typed}” for “{rule.expected}” {ignored ? 'is accepted' : 'is marked wrong'}
                </span>
              </div>
            </div>
            <div className="segmented" role="radiogroup" aria-label={rule.name}>
              <label>
                <input type="radio" name={`${id}-${rule.key}`} checked={ignored} onChange={() => set(true)} />
                <span>Ignore</span>
              </label>
              <label>
                <input type="radio" name={`${id}-${rule.key}`} checked={!ignored} onChange={() => set(false)} />
                <span>Check</span>
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default MarkingRules;
