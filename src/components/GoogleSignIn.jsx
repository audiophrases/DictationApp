import { useEffect, useRef, useState } from 'react';
import { loadGoogleIdentity } from '../lib/studentAuth';

export default function GoogleSignIn({ clientId, onCredential }) {
  const container = useRef(null);
  const callback = useRef(onCredential);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { callback.current = onCredential; }, [onCredential]);

  useEffect(() => {
    let active = true;
    const element = container.current;
    setError('');
    loadGoogleIdentity().then((identity) => {
      if (!active) return;
      identity.initialize({
        client_id: clientId,
        callback: (response) => {
          if (active && response.credential) callback.current(response.credential);
        },
      });
      element.replaceChildren();
      identity.renderButton(element, {
        theme: 'filled_blue', size: 'large', text: 'continue_with',
        width: Math.max(200, Math.min(320, element.clientWidth)),
      });
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; element?.replaceChildren(); };
  }, [clientId, retry]);

  return (
    <div>
      <div ref={container} style={{ minHeight: '44px' }} />
      {error && <>
        <p className="fetch-error" role="alert">{error}</p>
        <button type="button" className="btn-ghost" onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </>}
    </div>
  );
}
