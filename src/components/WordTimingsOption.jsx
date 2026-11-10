// The one switch for speech-recognised word timings (browserWhisper.js),
// shown wherever recordings without word timings enter the splitting studio.
export default function WordTimingsOption({ checked, disabled, onChange }) {
  return <label className="edit-check">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>Find the word timings with speech recognition, so the splits fall between the right words
      <span className="field-hint" style={{ display: 'block', margin: 0 }}>Runs in this browser; the first time downloads a 60 MB speech model, kept for next time. Takes about as long as the recordings last.</span></span>
  </label>;
}
